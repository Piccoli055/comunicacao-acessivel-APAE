"""Envio web autenticado, catálogo canônico e repetição idempotente."""
from contextlib import closing
import sqlite3
import unittest
from urllib.request import build_opener
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor
import test_modo_aluno
import test_fluxo


class EnvioAluno(unittest.TestCase):
    setUp = test_fluxo.Fluxo.setUp
    tearDown = test_fluxo.Fluxo.tearDown
    api = test_fluxo.Fluxo.api
    chamar = test_modo_aluno.ModoAluno.chamar
    negar = test_modo_aluno.ModoAluno.negar
    vinculo = test_modo_aluno.ModoAluno.vinculo
    navegador_aluno = test_modo_aluno.ModoAluno.navegador_aluno

    def preparar(self):
        aluno=self.api('/api/alunos',{'nome':'Aluno fictício','autorizado':True})
        self.vinculo(aluno)
        cliente,cookies=self.navegador_aluno()
        return aluno,cliente,cookies

    def test_resolve_identidade_catalogo_responsavel_e_reenvio(self):
        aluno,cliente,_=self.preparar()
        tutor=self.api('/api/tutores',{'nome':'Tutora fictícia','usuario':'lili','senha':'123','alunos':[aluno['id']]})
        dados={'id':'a'*32,'mensagem':'ajuda','aluno_id':aluno['id'],'frase':'Texto adulterado','dispositivo':'Outro','prioridade':'normal','tutor_id':'falso'}
        self.chamar(cliente,'/api/aluno/enviar',dados)
        primeiro=self.api('/api/pedidos')
        self.assertEqual(len(primeiro),1)
        pedido=primeiro[0]
        self.assertEqual((pedido['frase'],pedido['aluno_id'],pedido['dispositivo'],pedido['prioridade']),('Preciso de ajuda.',aluno['id'],'Sala 1','ajuda'))
        self.assertEqual(pedido['encaminhamento'],'responsavel')
        self.assertEqual(pedido['tutores'][0]['id'],tutor['id'])
        self.api('/api/confirmar',{'id':pedido['id']})
        self.chamar(cliente,'/api/aluno/enviar',dados)
        repetido=self.api('/api/pedidos')
        self.assertEqual(len(repetido),1)
        self.assertEqual(repetido[0]['estado'],'recebido')
        self.assertEqual(repetido[0]['recebido'],pedido['recebido'])
        self.assertEqual(repetido[0]['tutores'],pedido['tutores'])
        self.negar(409,cliente,'/api/aluno/enviar',dict(dados,mensagem='agua'))
        self.chamar(cliente,'/api/aluno/enviar',dict(dados,id='b'*32))
        self.assertEqual(len(self.api('/api/pedidos')),2)

    def test_sessao_cabecalho_catalogo_e_identificacao_obrigatorios(self):
        aluno,cliente,_=self.preparar()
        dados={'id':'a'*32,'mensagem':'agua','aluno_id':aluno['id']}
        self.negar(401,build_opener(),'/api/aluno/enviar',dados,codigo=self.codigo)
        self.negar(401,self.navegador,'/api/aluno/enviar',dados)
        self.negar(403,cliente,'/api/aluno/enviar',dados,portal='tutora')
        for campos in ({'id':'x'},{'id':None},{'mensagem':[]},{'mensagem':'inventada'}):
            self.negar(400,cliente,'/api/aluno/enviar',dict(dados,**campos))
        self.negar(409,cliente,'/api/aluno/enviar',dict(dados,aluno_id='outro'))
        self.api('/api/alunos/situacao',{'id':aluno['id'],'versao':1,'ativo':False,'confirmado':True})
        self.negar(409,cliente,'/api/aluno/enviar',dados)
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con,con:
            con.execute('UPDATE sessoes_comunicador SET expira=0')
        self.negar(401,cliente,'/api/aluno/enviar',dados)
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_selecao_manual_sorteio_e_troca_em_outra_aba(self):
        aluno=self.api('/api/alunos',{'nome':'Aluno livre','autorizado':True})
        outro=self.api('/api/alunos',{'nome':'Outro aluno','autorizado':True})
        tutor=self.api('/api/tutores',{'nome':'Tutora fictícia','usuario':'lili','senha':'123','alunos':[]})
        cliente=build_opener(HTTPCookieProcessor(CookieJar()))
        self.chamar(cliente,'/api/login',{'instituicao':'164275','usuario':'testedev','senha':'123456'},portal='tutora')
        self.chamar(cliente,'/api/aluno/liberar',{})
        self.chamar(cliente,'/api/aluno/selecionar',{'aluno_id':aluno['id']})
        dados={'id':'a'*32,'mensagem':'agua','aluno_id':aluno['id']}
        self.chamar(cliente,'/api/aluno/enviar',dados)
        pedido=self.api('/api/pedidos')[0]
        self.assertEqual(pedido['aluno_id'],aluno['id'])
        self.assertEqual(pedido['encaminhamento'],'aleatorio')
        self.assertEqual(pedido['tutores'][0]['id'],tutor['id'])
        self.chamar(cliente,'/api/aluno/selecionar',{'aluno_id':outro['id']})
        self.negar(409,cliente,'/api/aluno/enviar',dados)
        self.assertEqual(len(self.api('/api/pedidos')),1)

    def test_reenvio_apos_nova_sessao_reinicio_e_expiracao_do_historico(self):
        import threading
        from datetime import datetime, timedelta, timezone
        from servidor import criar_servidor, limpar_expirados
        aluno,cliente,_=self.preparar()
        dados={'id':'c'*32,'mensagem':'agua','aluno_id':aluno['id']}
        self.chamar(cliente,'/api/aluno/enviar',dados)
        pedido=self.api('/api/pedidos')[0]
        self.api('/api/confirmar',{'id':pedido['id']})
        self.api('/api/atender',{'id':pedido['id']})
        novo,_=self.navegador_aluno()
        self.chamar(novo,'/api/aluno/enviar',dados)
        self.assertEqual(len(self.api('/api/pedidos')),1)
        self.assertEqual(self.api('/api/pedidos')[0]['estado'],'atendido')
        # O recibo impede ressuscitar o chamado depois das 48h do atendimento.
        db=self.pasta/'pedidos.sqlite3'
        with closing(sqlite3.connect(db)) as con,con:
            con.execute('UPDATE pedidos SET atualizado=?',((datetime.now(timezone.utc)-timedelta(hours=49)).isoformat(),))
        limpar_expirados(db)
        self.assertEqual(self.api('/api/pedidos'),[])
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.server,_=criar_servidor(('127.0.0.1',0),self.pasta)
        self.url='http://127.0.0.1:'+str(self.server.server_port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.chamar(novo,'/api/aluno/enviar',dados)
        self.assertEqual(self.api('/api/pedidos'),[])
        self.negar(409,novo,'/api/aluno/enviar',dict(dados,mensagem='comida'))
        with closing(sqlite3.connect(db)) as con:
            self.assertEqual([r[1] for r in con.execute('PRAGMA table_info(recibos_envio_web)')],['id','assinatura'])
            self.assertEqual(con.execute('SELECT count(*) FROM recibos_envio_web').fetchone()[0],1)

    def test_duas_tentativas_simultaneas_criam_um_chamado(self):
        from concurrent.futures import ThreadPoolExecutor
        aluno,cliente,_=self.preparar()
        self.api('/api/tutores',{'nome':'Tutora livre','usuario':'lili','senha':'123','alunos':[]})
        dados={'id':'d'*32,'mensagem':'ajuda','aluno_id':aluno['id']}
        with ThreadPoolExecutor(max_workers=2) as executor:
            resultados=list(executor.map(lambda _:self.chamar(cliente,'/api/aluno/enviar',dados),range(2)))
        self.assertEqual(resultados,[{'ok':True},{'ok':True}])
        pedidos=self.api('/api/pedidos')
        self.assertEqual(len(pedidos),1)
        self.assertEqual(pedidos[0]['encaminhamento'],'aleatorio')
        self.assertEqual(len(pedidos[0]['tutores']),1)


if __name__=='__main__':
    unittest.main()
