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
        self.perfil = self.api('/api/login', {'instituicao':'51995537839', 'usuario':'admdev', 'senha':'123456'})

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
        self.assertEqual(self.perfil['usuario'], 'admdev')
        self.assertEqual(self.api('/api/sessao')['cnpj'], '51995537839')
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
        base = {'instituicao':'51995537839', 'usuario':'admdev', 'senha':'123456'}
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
        dados = {'instituicao':'51995537839','usuario':'admdev','senha':'errada'}
        for i in range(5):
            with self.assertRaises(HTTPError) as e:
                self.api('/api/login', dados, codigo='sem-sessao')
            self.assertEqual(e.exception.code, 429 if i == 4 else 401)
        with self.assertRaises(HTTPError) as e:
            self.api('/api/login', {'instituicao':'51995537839','usuario':'admdev','senha':'123456'}, codigo='sem-sessao')
        self.assertEqual(e.exception.code, 429)

    def test_demo_nao_substitui_conta_existente_e_redefinir_revoga_sessoes(self):
        configurar_conta(self.pasta/'pedidos.sqlite3', '12345678000190', 'Tutora', 'senha-de-teste-2026')
        preparar_demo(self.pasta/'pedidos.sqlite3')
        with self.assertRaises(HTTPError):
            self.api('/api/pedidos')
        perfil = self.api('/api/login', {'instituicao':'12.345.678/0001-90','usuario':'tutora','senha':'senha-de-teste-2026'})
        self.assertEqual(perfil['perfil'], 'tutora')
        self.assertEqual(perfil['cnpj'], '12345678000190')

    def test_post_de_navegador_exige_cabecalho_do_portal(self):
        req = Request(self.url+'/api/logout', data=b'{}', headers={'Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as e:
            self.navegador.open(req)
        self.assertEqual(e.exception.code, 403)
        self.assertEqual(self.api('/api/sessao')['perfil'], 'admdev')


if __name__ == '__main__':
    unittest.main()
