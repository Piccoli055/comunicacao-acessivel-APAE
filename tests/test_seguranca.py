"""Regressões de segurança com dados temporários, sem usar a instalação real."""
from contextlib import closing
from pathlib import Path
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request
from urllib.error import HTTPError

import acesso
from servidor import preparar
import test_fluxo


class SegurancaHTTP(unittest.TestCase):
    # Reutiliza apenas as ferramentas de montagem do servidor de teste.
    setUp = test_fluxo.Fluxo.setUp
    tearDown = test_fluxo.Fluxo.tearDown
    api = test_fluxo.Fluxo.api
    def test_envio_com_cookie_sem_cabecalho_portal_e_rejeitado(self):
        corpo = json.dumps({'id':'csrf','frase':'Pedido indevido','dispositivo':'MVP'}).encode()
        req = Request(self.url+'/api/pedidos', data=corpo, headers={'Content-Type':'text/plain'})
        with self.assertRaises(HTTPError) as erro:
            self.navegador.open(req)
        self.assertEqual(erro.exception.code,403)
        erro.exception.close()
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_falha_no_banco_durante_autorizacao_retorna_503(self):
        with patch('servidor.consultar_sessao',side_effect=sqlite3.OperationalError('banco ocupado')):
            with self.assertRaises(HTTPError) as erro:
                self.api('/api/pedidos')
            self.assertEqual(erro.exception.code,503)
            erro.exception.close()
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_limpeza_temporariamente_indisponivel_nao_encerra_servidor(self):
        self.server.ultima_limpeza=0
        with patch('servidor.limpar_expirados',side_effect=sqlite3.OperationalError('banco ocupado')):
            self.server.service_actions()
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_atendimentos_simultaneos_gravam_uma_unica_transicao(self):
        self.api('/api/pedidos',{'id':'concorrente','frase':'Pedido','dispositivo':'MVP'})
        self.api('/api/confirmar',{'id':'concorrente'})
        db=self.pasta/'pedidos.sqlite3'
        with closing(sqlite3.connect(db)) as con, con:
            con.execute('CREATE TABLE auditoria_teste (instante TEXT)')
            con.execute("CREATE TRIGGER contar_atendimentos AFTER UPDATE ON pedidos BEGIN INSERT INTO auditoria_teste VALUES (NEW.atualizado); END")
        # Atraso após a leitura amplia a janela de disputa entre requisições.
        class CursorLento(sqlite3.Cursor):
            def fetchone(self):
                row=super().fetchone()
                time.sleep(.1)
                return row
        class ConexaoLenta(sqlite3.Connection):
            def execute(self,sql,*args):
                if sql.startswith('SELECT estado FROM pedidos'):
                    return self.cursor(factory=CursorLento).execute(sql,*args)
                return super().execute(sql,*args)
        original=sqlite3.connect
        def conectar(*args,**kwargs):
            return original(*args,**dict(kwargs,factory=ConexaoLenta))
        cookie='; '.join(c.name+'='+c.value for c in self.cookies)
        inicio=threading.Barrier(6)
        def atender(_):
            inicio.wait(10)
            req=Request(self.url+'/api/atender',data=b'{"id":"concorrente"}',headers={'Cookie':cookie,'X-Portal':'tutora','Content-Type':'application/json'})
            with urlopen(req,timeout=10) as resposta:
                return json.load(resposta)
        with patch('servidor.sqlite3.connect',side_effect=conectar), ThreadPoolExecutor(max_workers=6) as pool:
            self.assertTrue(all(r['ok'] for r in pool.map(atender,range(6))))
        with closing(sqlite3.connect(db)) as con:
            self.assertEqual(con.execute('SELECT count(*) FROM auditoria_teste').fetchone()[0],1)
        self.assertEqual(self.api('/api/pedidos')[0]['estado'],'atendido')

    def test_ajuda_nao_perde_prioridade_por_campo_do_remetente(self):
        self.api('/api/pedidos',{'id':'ajuda','frase':'Preciso de ajuda.','dispositivo':'MVP','prioridade':'normal'},codigo=self.codigo)
        self.assertEqual(self.api('/api/pedidos')[0]['prioridade'],'ajuda')


class ConcorrenciaAcesso(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db,_=preparar(Path(self.temp.name))
        acesso.preparar_demo(self.db)

    def tearDown(self):
        self.temp.cleanup()

    def sobrepor(self, durante, senha='errada'):
        entrou,liberar=threading.Event(),threading.Event()
        original=acesso.hashlib.pbkdf2_hmac
        def derivar(*args,**kwargs):
            if threading.current_thread().name=='login-pausado':
                entrou.set()
                if not liberar.wait(10):
                    raise AssertionError('Teste não liberou o login')
            return original(*args,**kwargs)
        resultado=[]
        def login():
            try: resultado.append(acesso.autenticar(self.db,'164275','testedev',senha,'teste'))
            except acesso.ErroAcesso as erro: resultado.append(erro)
        with patch('acesso.hashlib.pbkdf2_hmac',side_effect=derivar):
            thread=threading.Thread(target=login,name='login-pausado')
            thread.start()
            try:
                self.assertTrue(entrou.wait(10))
                durante()
            finally:
                liberar.set()
                thread.join(10)
            self.assertFalse(thread.is_alive())
        return resultado[0]

    def test_falhas_sobrepostas_nao_perdem_contagem(self):
        def segunda():
            with self.assertRaises(acesso.ErroAcesso):
                acesso.autenticar(self.db,'164275','testedev','errada','teste')
        self.sobrepor(segunda)
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute('SELECT falhas FROM tentativas_acesso WHERE origem=?',('teste',)).fetchone()[0],2)

    def test_redefinicao_durante_login_nao_cria_sessao_com_senha_antiga(self):
        resultado=self.sobrepor(lambda: acesso.configurar_conta(self.db,'164275','testedev','outra-senha-segura'),senha='123456')
        self.assertIsInstance(resultado,acesso.ErroAcesso)
        with closing(sqlite3.connect(self.db)) as con:
            self.assertEqual(con.execute('SELECT count(*) FROM sessoes').fetchone()[0],0)


if __name__=='__main__':
    unittest.main()
