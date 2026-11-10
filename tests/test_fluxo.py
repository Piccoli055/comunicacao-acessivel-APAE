import json
from http.cookiejar import CookieJar
from contextlib import closing
from datetime import datetime, timedelta, timezone
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor

from servidor import criar_servidor, limpar_expirados, preparar
from transporte import Fila
from acesso import configurar_conta, preparar_demo


class Fluxo(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pasta = Path(self.temp.name)
        self.server, self.codigo = criar_servidor(('127.0.0.1', 0), self.pasta, modo_demo=True)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.cookies = CookieJar()
        self.navegador = build_opener(HTTPCookieProcessor(self.cookies))
        self.perfil = self.api('/api/login', {'instituicao':'164275', 'usuario':'testedev', 'senha':'123456'})

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def api(self, rota, dados=None, codigo=None):
        headers = {'X-Portal':'tutora', 'Content-Type':'application/json'}
        cliente = self.navegador
        if codigo is not None:
            headers['X-Codigo'] = codigo
            cliente = build_opener()
        req = Request(self.url + rota, data=json.dumps(dados).encode() if dados is not None else None, headers=headers)
        with cliente.open(req, timeout=8) as r:
            return json.load(r)

    def test_listagem_alunos_vazia_e_com_cadastros_ativos_e_inativos(self):
        self.assertEqual(self.api('/api/alunos'), [])
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute("INSERT INTO alunos (id,nome,perfil_acessibilidade,ativo,foto) VALUES ('b','Bruno','motora',0,'caminho-interno.jpg')")
            con.execute("INSERT INTO alunos (id,nome) VALUES ('a','Ana')")
        self.assertEqual(self.api('/api/alunos'), [
            {'id':'a','nome':'Ana','perfil_acessibilidade':'padrao','ativo':1,'autorizado_em':None,'versao':1,'foto_url':None},
            {'id':'b','nome':'Bruno','perfil_acessibilidade':'motora','ativo':0,'autorizado_em':None,'versao':1,'foto_url':None},
        ])

    def test_listagem_alunos_exige_sessao_e_rejeita_credencial_dispositivo(self):
        for codigo in ('errado', self.codigo):
            with self.assertRaises(HTTPError) as e:
                self.api('/api/alunos', codigo=codigo)
            self.assertEqual(e.exception.code, 401)
        self.api('/api/logout', {})
        with self.assertRaises(HTTPError) as e:
            self.api('/api/alunos')
        self.assertEqual(e.exception.code, 401)

    def test_cadastro_foto_edicao_e_exclusao_por_http(self):
        from PIL import Image
        from io import BytesIO
        import base64
        saida = BytesIO()
        Image.new('RGB',(30,30),'red').save(saida,format='PNG')
        dados = {'nome':'Aluno fictício','autorizado':True,'foto':base64.b64encode(saida.getvalue()).decode()}
        aluno = self.api('/api/alunos',dados)
        req = Request(self.url+aluno['foto_url'])
        with self.navegador.open(req) as foto:
            self.assertEqual(foto.headers['Content-Type'],'image/jpeg')
            self.assertEqual(foto.headers['Cache-Control'],'no-store')
            self.assertEqual(Image.open(BytesIO(foto.read())).format,'JPEG')
        with self.assertRaises(HTTPError) as erro:
            urlopen(Request(self.url+aluno['foto_url']))
        self.assertEqual(erro.exception.code,401)
        with self.assertRaises(HTTPError) as erro:
            self.api(aluno['foto_url'],codigo=self.codigo)
        self.assertEqual(erro.exception.code,401)
        for rota, corpo in [('/api/alunos',dados),('/api/alunos/editar',dict(dados,id=aluno['id'],versao=1)),('/api/alunos/situacao',{'id':aluno['id'],'versao':1,'ativo':False,'confirmado':True}),('/api/alunos/excluir',{'id':aluno['id'],'versao':1,'confirmacao':aluno['nome']})]:
            with self.assertRaises(HTTPError) as erro:
                self.api(rota,corpo,codigo=self.codigo)
            self.assertEqual(erro.exception.code,401)
        editado = self.api('/api/alunos/editar',{'id':aluno['id'],'versao':1,'nome':'Nome editado','autorizado':True})
        self.assertEqual(editado['nome'],'Nome editado')
        self.api('/api/alunos/excluir',{'id':aluno['id'],'versao':editado['versao'],'confirmacao':editado['nome']})
        self.assertEqual(self.api('/api/alunos'),[])
        with self.assertRaises(HTTPError) as erro:
            self.navegador.open(req)
        self.assertEqual(erro.exception.code,404)

    def test_api_vinculo_exige_sessao_e_cabecalho(self):
        aluno = self.api('/api/alunos',{'nome':'Aluno do vínculo','autorizado':True})
        dados = {'dispositivo':'Comunicador 01','aluno_id':aluno['id'],'versao':0}
        self.assertEqual(self.api('/api/comunicadores'),[])
        for codigo in ('invalido',self.codigo):
            for rota, corpo in (('/api/comunicadores',None),('/api/comunicadores/vincular',dados)):
                with self.assertRaises(HTTPError) as erro:
                    self.api(rota,corpo,codigo=codigo)
                self.assertEqual(erro.exception.code,401)
        req = Request(self.url+'/api/comunicadores/vincular',data=json.dumps(dados).encode(),headers={'Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as erro:
            self.navegador.open(req)
        self.assertEqual(erro.exception.code,403)
        self.api('/api/comunicadores/vincular',dados)
        self.assertEqual(self.api('/api/comunicadores')[0]['aluno_id'],aluno['id'])
        self.api('/api/pedidos',{'id':'sem-mudar','frase':'Pedido','dispositivo':'Comunicador 01'},codigo=self.codigo)
        self.assertEqual(self.api('/api/pedidos')[0]['aluno_id'],aluno['id'])
        self.assertEqual(self.api('/api/pedidos')[0]['aluno_nome'],aluno['nome'])

    def test_fila_envia_e_servidor_registra_aluno_do_comunicador(self):
        aluno = self.api('/api/alunos', {'nome':'Aluno da sala','autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':aluno['id'],'versao':0})
        fila = Fila(self.pasta/'fila-vinculada.sqlite3')
        fila.adicionar('Quero água.','Sala 1')
        fila.enviar(self.url,self.codigo)
        self.assertEqual(fila.pendentes(),[])
        pedido = self.api('/api/pedidos')[0]
        self.assertEqual((pedido['aluno_id'],pedido['aluno_nome']),(aluno['id'],aluno['nome']))
        self.assertEqual(pedido['estado'],'novo')
        preparar(self.pasta)
        self.assertEqual(self.api('/api/pedidos')[0],pedido)

    def test_pedido_sem_vinculo_ou_aluno_inativo_continua_chegando(self):
        aluno = self.api('/api/alunos',{'nome':'Aluno inativo','autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':aluno['id'],'versao':0})
        self.api('/api/alunos/situacao',{'id':aluno['id'],'versao':1,'ativo':False,'confirmado':True})
        for identificador, dispositivo in [('inativo','Sala 1'),('sem-vinculo','Outro aparelho')]:
            self.api('/api/pedidos',{'id':identificador,'dispositivo':dispositivo,'frase':'Ajuda','aluno_id':aluno['id'],'aluno_nome':'Nome forjado'},codigo=self.codigo)
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista),2)
        self.assertTrue(all(p['aluno_id'] is None and p['aluno_nome'] is None for p in lista))

    def test_identificacao_resolvida_no_recebimento_e_reenvio_nao_reassocia(self):
        ana = self.api('/api/alunos',{'nome':'Ana fictícia','autorizado':True})
        bruno = self.api('/api/alunos',{'nome':'Bruno fictício','autorizado':True})
        antigo = {'id':'antes-do-vinculo','frase':'Pedido','dispositivo':'Sala 1'}
        self.api('/api/pedidos',antigo,codigo=self.codigo)
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':ana['id'],'versao':0})
        pedido = {'id':'com-vinculo','frase':'Pedido','dispositivo':'Sala 1','aluno_id':bruno['id'],'aluno_nome':bruno['nome']}
        self.api('/api/pedidos',pedido,codigo=self.codigo)
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':bruno['id'],'versao':1})
        self.api('/api/pedidos',pedido,codigo=self.codigo)
        self.api('/api/pedidos',antigo,codigo=self.codigo)
        self.api('/api/pedidos',{'id':'novo-vinculo','frase':'Pedido','dispositivo':'Sala 1'},codigo=self.codigo)
        por_id = {p['id']:p for p in self.api('/api/pedidos')}
        self.assertIsNone(por_id['antes-do-vinculo']['aluno_id'])
        self.assertEqual(por_id['com-vinculo']['aluno_id'],ana['id'])
        self.assertEqual(por_id['com-vinculo']['aluno_nome'],ana['nome'])
        self.assertEqual(por_id['novo-vinculo']['aluno_id'],bruno['id'])
        self.assertEqual(len(por_id),3)

    def test_excluir_aluno_remove_identificacao_sem_apagar_chamados(self):
        aluno = self.api('/api/alunos',{'nome':'Aluno a excluir','autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':aluno['id'],'versao':0})
        self.api('/api/pedidos',{'id':'preservado','frase':'Ajuda','dispositivo':'Sala 1'},codigo=self.codigo)
        antes = self.api('/api/pedidos')[0]
        self.api('/api/alunos/excluir',{'id':aluno['id'],'versao':1,'confirmacao':aluno['nome']})
        depois = self.api('/api/pedidos')[0]
        self.assertIsNone(depois['aluno_id'])
        self.assertIsNone(depois['aluno_nome'])
        for campo in ('id','frase','estado','recebido','atualizado'):
            self.assertEqual(depois[campo],antes[campo])

    def test_foto_do_chamado_acompanha_cadastro_sem_trocar_nome_registrado(self):
        import base64
        from io import BytesIO
        from PIL import Image
        def foto(cor):
            saida = BytesIO()
            Image.new('RGB',(20,20),cor).save(saida,format='PNG')
            return base64.b64encode(saida.getvalue()).decode()
        aluno = self.api('/api/alunos',{'nome':'Nome no envio','foto':foto('red'),'autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':aluno['id'],'versao':0})
        self.api('/api/pedidos',{'id':'com-foto','dispositivo':'Sala 1','frase':'Água'},codigo=self.codigo)
        original = self.api('/api/pedidos')[0]
        self.assertEqual(original['aluno_foto_url'],aluno['foto_url'])
        editado = self.api('/api/alunos/editar',{'id':aluno['id'],'versao':1,'nome':'Nome atual','foto':foto('blue'),'autorizado':True})
        atualizado = self.api('/api/pedidos')[0]
        self.assertEqual(atualizado['aluno_nome'],'Nome no envio')
        self.assertEqual(atualizado['aluno_foto_url'],editado['foto_url'])
        self.assertNotEqual(atualizado['aluno_foto_url'],original['aluno_foto_url'])
        self.api('/api/alunos/editar',{'id':aluno['id'],'versao':2,'nome':'Nome atual','foto':None,'autorizado':True})
        self.assertIsNone(self.api('/api/pedidos')[0]['aluno_foto_url'])

    def test_identificacao_historica_persiste_em_mudancas_e_reinicio_real(self):
        ana = self.api('/api/alunos',{'nome':'Nome original','autorizado':True})
        bruno = self.api('/api/alunos',{'nome':'Outro aluno','autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':ana['id'],'versao':0})
        for identificador in ('atendido-original','pendente-original'):
            self.api('/api/pedidos',{'id':identificador,'frase':'Pedido original','dispositivo':'Sala 1'},codigo=self.codigo)
        self.api('/api/confirmar',{'id':'atendido-original'})
        self.api('/api/atender',{'id':'atendido-original'})
        originais = {p['id']:p for p in self.api('/api/pedidos')}
        self.api('/api/alunos/editar',{'id':ana['id'],'versao':1,'nome':'Nome revisado','autorizado':True})
        self.api('/api/alunos/situacao',{'id':ana['id'],'versao':2,'ativo':False,'confirmado':True})
        self.assertEqual({p['id']:p for p in self.api('/api/pedidos')},originais)
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':bruno['id'],'versao':1})
        self.api('/api/pedidos',{'id':'outro-aluno','frase':'Pedido novo','dispositivo':'Sala 1'},codigo=self.codigo)
        # Reenvio não altera nome, mensagem, comunicador nem situação já registrada.
        self.api('/api/pedidos',{'id':'atendido-original','frase':'Tentativa de alterar','dispositivo':'Sala 1','aluno_id':bruno['id']},codigo=self.codigo)
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':None,'versao':2})
        self.api('/api/pedidos',{'id':'sem-aluno','frase':'Pedido','dispositivo':'Sala 1'},codigo=self.codigo)
        self.api('/api/alunos/situacao',{'id':ana['id'],'versao':3,'ativo':True,'confirmado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':ana['id'],'versao':3})
        self.api('/api/pedidos',{'id':'nome-revisado','frase':'Pedido novo','dispositivo':'Sala 1'},codigo=self.codigo)
        por_id = {p['id']:p for p in self.api('/api/pedidos')}
        for identificador,pedido in originais.items():
            self.assertEqual(por_id[identificador],pedido)
        self.assertEqual(por_id['outro-aluno']['aluno_id'],bruno['id'])
        self.assertEqual(por_id['nome-revisado']['aluno_nome'],'Nome revisado')
        self.assertIsNone(por_id['sem-aluno']['aluno_id'])
        # Encerra e inicia um servidor novo com o mesmo banco e a mesma sessão.
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server, _ = criar_servidor(('127.0.0.1',0),self.pasta)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.assertEqual({p['id']:p for p in self.api('/api/pedidos')},por_id)
        # Exclusão explícita anonimiza todos os nomes antigos desse aluno, sem afetar o outro.
        self.api('/api/alunos/excluir',{'id':ana['id'],'versao':4,'confirmacao':'Nome revisado'})
        finais = {p['id']:p for p in self.api('/api/pedidos')}
        for identificador in ('atendido-original','pendente-original','nome-revisado'):
            esperado = dict(por_id[identificador],aluno_id=None,aluno_nome=None,aluno_foto_url=None)
            self.assertEqual(finais[identificador],esperado)
        self.assertEqual(finais['outro-aluno'],por_id['outro-aluno'])

    def test_identificacao_historica_respeita_48h_do_atendimento(self):
        aluno = self.api('/api/alunos',{'nome':'Nome do chamado','autorizado':True})
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala 1','aluno_id':aluno['id'],'versao':0})
        for identificador in ('atendido-antigo','pendente-antigo'):
            self.api('/api/pedidos',{'id':identificador,'frase':'Pedido','dispositivo':'Sala 1'},codigo=self.codigo)
        self.api('/api/confirmar',{'id':'atendido-antigo'})
        self.api('/api/atender',{'id':'atendido-antigo'})
        instante = datetime.now(timezone.utc)
        db = self.pasta/'pedidos.sqlite3'
        atendimento = instante-timedelta(hours=47,minutes=30)
        with closing(sqlite3.connect(db)) as con, con:
            con.execute('UPDATE pedidos SET recebido=?',((instante-timedelta(hours=72)).isoformat(),))
            con.execute('UPDATE pedidos SET atualizado=? WHERE id=?',(atendimento.isoformat(),'atendido-antigo'))
        self.api('/api/alunos/editar',{'id':aluno['id'],'versao':1,'nome':'Nome do cadastro atual','autorizado':True})
        self.api('/api/alunos/situacao',{'id':aluno['id'],'versao':2,'ativo':False,'confirmado':True})
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista),2)
        self.assertTrue(all(p['aluno_nome']=='Nome do chamado' and p['aluno_id']==aluno['id'] for p in lista))
        self.assertEqual(limpar_expirados(db,instante+timedelta(hours=1)),1)
        restantes = self.api('/api/pedidos')
        self.assertEqual(len(restantes),1)
        self.assertEqual(restantes[0]['id'],'pendente-antigo')
        self.assertEqual(restantes[0]['aluno_nome'],'Nome do chamado')

    def test_acesso_e_validacao(self):
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos', codigo='errado')
        self.assertEqual(e.exception.code, 401)
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos', {})
        self.assertEqual(e.exception.code, 400)

    def test_reenvio_nao_duplica_e_tutora_confirma(self):
        pedido = {'id': 'teste-1', 'frase': 'Quero água.', 'dispositivo': 'MVP'}
        self.api('/api/pedidos', pedido)
        self.api('/api/pedidos', pedido)
        pedidos = self.api('/api/pedidos')
        self.assertEqual(len(pedidos), 1)
        self.assertEqual(pedidos[0]['confirmado'], 0)
        self.api('/api/confirmar', {'id': 'teste-1'})
        self.assertEqual(self.api('/api/pedidos')[0]['confirmado'], 1)

    def test_fila_sobrevive_a_falha_e_reabertura(self):
        caminho = self.pasta / 'fila.sqlite3'
        fila = Fila(caminho)
        fila.adicionar('Preciso de ajuda.')
        with self.assertRaises(HTTPError):
            fila.enviar(self.url, 'errado')
        reaberta = Fila(caminho)
        self.assertEqual(len(reaberta.pendentes()), 1)
        reaberta.enviar(self.url, self.codigo)
        self.assertEqual(reaberta.pendentes(), [])
        self.assertEqual(self.api('/api/pedidos')[0]['frase'], 'Preciso de ajuda.')

    def test_estados_sem_regressao(self):
        self.api('/api/pedidos', {'id':'fluxo', 'frase':'Preciso de ajuda.', 'dispositivo':'Sala 1'})
        with self.assertRaises(HTTPError) as e:
            self.api('/api/atender', {'id':'fluxo'})
        self.assertEqual(e.exception.code, 409)
        self.api('/api/confirmar', {'id':'fluxo'})
        self.assertEqual(self.api('/api/pedidos')[0]['estado'], 'recebido')
        self.api('/api/atender', {'id':'fluxo'})
        self.api('/api/confirmar', {'id':'fluxo'})
        self.api('/api/atender', {'id':'fluxo'})
        self.assertEqual(self.api('/api/pedidos')[0]['estado'], 'atendido')
        self.assertEqual(self.api('/api/pedidos')[0]['prioridade'], 'ajuda')

    def test_varios_comunicadores_e_mesma_frase_intencional(self):
        for i, aparelho in enumerate(['Sala 1', 'Sala 2', 'Sala 1']):
            self.api('/api/pedidos', {'id':str(i), 'frase':'Quero água.', 'dispositivo':aparelho})
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista), 3)
        self.assertEqual({p['dispositivo'] for p in lista}, {'Sala 1', 'Sala 2'})

    def test_exclusao_48h_apos_atendimento_preserva_pendentes(self):
        instante = datetime.now(timezone.utc)
        db = self.pasta/'pedidos.sqlite3'
        antigo = (instante-timedelta(days=10)).isoformat()
        casos = [('novo', 'novo', 100), ('recebido', 'recebido', 100),
                 ('expirado', 'atendido', 49), ('limite', 'atendido', 48),
                 ('recente', 'atendido', 47)]
        with closing(sqlite3.connect(db)) as con, con:
            for identificador, estado, horas in casos:
                con.execute('INSERT INTO pedidos (id,frase,dispositivo,recebido,estado,atualizado) VALUES (?,?,?,?,?,?)',
                            (identificador, 'Pedido', 'MVP', antigo, estado,
                             (instante-timedelta(hours=horas)).isoformat()))
        self.assertEqual(limpar_expirados(db, instante), 2)
        self.assertEqual({p['id'] for p in self.api('/api/pedidos')}, {'novo','recebido','recente'})
        with self.assertRaises(HTTPError) as e:
            self.api('/api/confirmar', {'id':'expirado'})
        self.assertEqual(e.exception.code, 404)

    def test_atendimento_inicia_48h_e_repeticoes_nao_renovam_prazo(self):
        self.api('/api/pedidos', {'id':'antigo', 'frase':'Pedido', 'dispositivo':'MVP'})
        db = self.pasta/'pedidos.sqlite3'
        with closing(sqlite3.connect(db)) as con, con:
            antigo = (datetime.now(timezone.utc)-timedelta(days=10)).isoformat()
            con.execute('UPDATE pedidos SET recebido=?, atualizado=? WHERE id=?', (antigo, antigo, 'antigo'))
        self.api('/api/confirmar', {'id':'antigo'})
        antes = datetime.now(timezone.utc)
        self.api('/api/atender', {'id':'antigo'})
        pedido = self.api('/api/pedidos')[0]
        atendimento = datetime.fromisoformat(pedido['atualizado'])
        self.assertGreaterEqual(atendimento, antes)
        self.api('/api/confirmar', {'id':'antigo'})
        self.api('/api/atender', {'id':'antigo'})
        self.assertEqual(self.api('/api/pedidos')[0]['atualizado'], pedido['atualizado'])
        self.assertEqual(limpar_expirados(db, atendimento+timedelta(hours=48, microseconds=-1000000)), 0)
        self.assertEqual(limpar_expirados(db, atendimento+timedelta(hours=48)), 1)

    def test_persistencia_apos_reabrir_e_limpeza_na_inicializacao(self):
        self.api('/api/pedidos', {'id':'mantido', 'frase':'Pedido', 'dispositivo':'MVP'})
        self.api('/api/confirmar', {'id':'mantido'})
        self.api('/api/pedidos', {'id':'antigo', 'frase':'Pedido', 'dispositivo':'MVP'})
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute("UPDATE pedidos SET estado='atendido', recebido=?, atualizado=? WHERE id=?", ((datetime.now(timezone.utc)-timedelta(days=10)).isoformat(), (datetime.now(timezone.utc)-timedelta(hours=49)).isoformat(), 'antigo'))
        _, codigo = preparar(self.pasta)
        self.assertEqual(codigo, self.codigo)
        lista = self.api('/api/pedidos')
        self.assertEqual(len(lista), 1)
        self.assertEqual(lista[0]['id'], 'mantido')
        self.assertEqual(lista[0]['estado'], 'recebido')

    def test_migracao_preserva_confirmacoes_do_banco_antigo(self):
        pasta = self.pasta / 'antigo'
        pasta.mkdir()
        with closing(sqlite3.connect(pasta/'pedidos.sqlite3')) as con, con:
            con.execute('CREATE TABLE pedidos (id TEXT PRIMARY KEY, frase TEXT, dispositivo TEXT, recebido TEXT, confirmado INTEGER DEFAULT 0)')
            con.execute('INSERT INTO pedidos VALUES (?,?,?,?,?)', ('legado','Oi','MVP',datetime.now(timezone.utc).isoformat(),1))
        db, _ = preparar(pasta)
        with closing(sqlite3.connect(db)) as con:
            self.assertEqual(con.execute('SELECT estado FROM pedidos').fetchone()[0], 'recebido')
            self.assertEqual(con.execute('SELECT aluno_id,aluno_nome FROM pedidos').fetchone(),(None,None))

    def test_acesso_protege_todas_as_acoes(self):
        for rota, dados in [('/api/config',None), ('/api/confirmar',{'id':'qualquer'}), ('/api/atender',{'id':'qualquer'}), ('/api/pedidos',{'id':'qualquer'})]:
            with self.assertRaises(HTTPError) as e:
                self.api(rota, dados, codigo='errado')
            self.assertEqual(e.exception.code, 401)

    def test_nao_oculta_pendentes_apos_100_pedidos(self):
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.executemany('INSERT INTO pedidos (id,frase,dispositivo,recebido,atualizado) VALUES (?,?,?,?,?)',
                            [(str(i),'Pedido','MVP',datetime.now(timezone.utc).isoformat(),datetime.now(timezone.utc).isoformat()) for i in range(105)])
        self.assertEqual(len(self.api('/api/pedidos')), 105)


    def test_login_demo_retorna_perfil_e_sessao(self):
        self.assertEqual(self.perfil['perfil'], 'admdev')
        self.assertEqual(self.perfil['usuario'], 'testedev')
        self.assertEqual(self.api('/api/sessao')['cnpj'], '164275')
        self.assertEqual(self.api('/api/config')['retencao_horas'], 48)
        cookie = next(iter(self.cookies))
        self.assertTrue(cookie.has_nonstandard_attr('HttpOnly'))
        self.assertEqual(cookie.get_nonstandard_attr('SameSite'), 'Strict')
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con:
            sal, resumo = con.execute('SELECT sal,senha_hash FROM conta_tutora').fetchone()
            token_hash = con.execute('SELECT token_hash FROM sessoes').fetchone()[0]
        self.assertNotIn('123456', (sal, resumo))
        self.assertNotEqual(token_hash, cookie.value)

    def test_credenciais_erradas_nao_identificam_campo(self):
        base = {'instituicao':'164275', 'usuario':'testedev', 'senha':'123456'}
        for campo in base:
            dados = dict(base)
            dados[campo] = 'incorreto'
            with self.assertRaises(HTTPError) as e:
                self.api('/api/login', dados, codigo='sem-sessao')
            self.assertEqual(e.exception.code, 401)
            self.assertEqual(json.load(e.exception)['erro'], 'CNPJ, usuário ou senha incorretos.')

    def test_credencial_dispositivo_envia_mas_nao_le_nem_atende(self):
        self.api('/api/pedidos', {'id':'dispositivo','frase':'Pedido','dispositivo':'MVP'}, codigo=self.codigo)
        for rota, dados in [('/api/pedidos',None),('/api/config',None),('/api/confirmar',{'id':'dispositivo'}),('/api/atender',{'id':'dispositivo'})]:
            with self.assertRaises(HTTPError) as e:
                self.api(rota, dados, codigo=self.codigo)
            self.assertEqual(e.exception.code, 401)

    def test_logout_revoga_sessao(self):
        self.api('/api/logout', {})
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos')
        self.assertEqual(e.exception.code, 401)
        self.assertEqual(len(list(self.cookies)), 0)

    def test_sessao_expirada_exige_login(self):
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute('UPDATE sessoes SET expira=0')
        with self.assertRaises(HTTPError) as e:
            self.api('/api/pedidos')
        self.assertEqual(e.exception.code, 401)

    def test_limite_de_tentativas(self):
        dados = {'instituicao':'164275','usuario':'testedev','senha':'errada'}
        for i in range(5):
            with self.assertRaises(HTTPError) as e:
                self.api('/api/login', dados, codigo='sem-sessao')
            self.assertEqual(e.exception.code, 429 if i == 4 else 401)
        with self.assertRaises(HTTPError) as e:
            self.api('/api/login', {'instituicao':'164275','usuario':'testedev','senha':'123456'}, codigo='sem-sessao')
        self.assertEqual(e.exception.code, 429)

    def test_demo_nao_substitui_conta_existente_e_redefinir_revoga_sessoes(self):
        configurar_conta(self.pasta/'pedidos.sqlite3', '12345678000190', 'Tutora', 'senha-de-teste-2026')
        preparar_demo(self.pasta/'pedidos.sqlite3')
        with self.assertRaises(HTTPError):
            self.api('/api/pedidos')
        perfil = self.api('/api/login', {'instituicao':'12.345.678/0001-90','usuario':'tutora','senha':'senha-de-teste-2026'})
        self.assertEqual(perfil['perfil'], 'tutora')
        self.assertEqual(perfil['cnpj'], '12345678000190')

    def test_demo_migra_antigo_acesso_sem_apagar_dados(self):
        from acesso import consultar_sessao
        configurar_conta(self.pasta/'pedidos.sqlite3', '12345678000190', 'admdev', '123456', perfil='admdev')
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute("UPDATE conta_tutora SET cnpj='51995537839'")
        token = 'sessao-legada-para-teste-de-migracao'
        import hashlib, time
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute("INSERT INTO alunos (id,nome) VALUES ('preservado','Aluno fictício')")
            con.execute('INSERT INTO sessoes VALUES (?,?)', (hashlib.sha256(token.encode()).hexdigest(),time.time()+3600))
        self.assertIsNotNone(consultar_sessao(self.pasta/'pedidos.sqlite3',token))
        preparar_demo(self.pasta/'pedidos.sqlite3')
        self.assertIsNone(consultar_sessao(self.pasta/'pedidos.sqlite3',token))
        perfil = self.api('/api/login',{'instituicao':'164275','usuario':'testedev','senha':'123456'})
        self.assertEqual(perfil['usuario'],'testedev')
        self.assertEqual(self.api('/api/alunos')[0]['nome'],'Aluno fictício')

    def test_post_de_navegador_exige_cabecalho_do_portal(self):
        req = Request(self.url+'/api/logout', data=b'{}', headers={'Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as e:
            self.navegador.open(req)
        self.assertEqual(e.exception.code, 403)
        self.assertEqual(self.api('/api/sessao')['perfil'], 'admdev')


if __name__ == '__main__':
    unittest.main()
