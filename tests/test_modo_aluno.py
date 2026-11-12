"""Identificação do navegador, privacidade e atualização do aluno vinculado."""
import base64
from contextlib import closing
from http.cookiejar import CookieJar
from io import BytesIO
import json
import sqlite3
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor
from PIL import Image

import test_fluxo


class ModoAluno(unittest.TestCase):
    setUp = test_fluxo.Fluxo.setUp
    tearDown = test_fluxo.Fluxo.tearDown
    api = test_fluxo.Fluxo.api

    def navegador_aluno(self,dispositivo='Sala 1'):
        cookies=CookieJar()
        cliente=build_opener(HTTPCookieProcessor(cookies))
        self.chamar(cliente,'/api/login',{'instituicao':'164275','usuario':'testedev','senha':'123456'},portal='tutora')
        self.chamar(cliente,'/api/aluno/configurar',{'dispositivo':dispositivo})
        return cliente,cookies

    def chamar(self,cliente,rota,dados=None,portal='aluno',codigo=None):
        headers={'X-Portal':portal,'Content-Type':'application/json'}
        if codigo:headers['X-Codigo']=codigo
        req=Request(self.url+rota,data=None if dados is None else json.dumps(dados).encode(),headers=headers)
        with cliente.open(req,timeout=8) as resposta:
            return json.load(resposta)

    def negar(self,status,cliente,rota,dados=None,**kwargs):
        with self.assertRaises(HTTPError) as erro:
            self.chamar(cliente,rota,dados,**kwargs)
        self.assertEqual(erro.exception.code,status)
        erro.exception.close()

    def vinculo(self,aluno=None,versao=0,dispositivo='Sala 1'):
        self.api('/api/comunicadores/vincular',{'dispositivo':dispositivo,'aluno_id':None if aluno is None else aluno['id'],'versao':versao})

    def foto(self,cor):
        saida=BytesIO()
        Image.new('RGB',(40,40),cor).save(saida,format='PNG')
        return base64.b64encode(saida.getvalue()).decode()

    def test_configurar_exige_tutora_e_nao_aceita_chave_compartilhada(self):
        self.vinculo()
        visitante=build_opener()
        for codigo in (None,self.codigo):
            self.negar(401,visitante,'/api/aluno/configurar',{'dispositivo':'Sala 1'},codigo=codigo)
        self.negar(401,visitante,'/api/aluno/perfil',codigo=self.codigo)
        self.negar(401,self.navegador,'/api/aluno/perfil')
        for dispositivo in ('','   ','x'*81,[],None):
            self.negar(400,self.navegador,'/api/aluno/configurar',{'dispositivo':dispositivo})
        self.negar(404,self.navegador,'/api/aluno/configurar',{'dispositivo':'Não cadastrado'})
        self.assertEqual(self.api('/api/sessao')['usuario'],'testedev')

    def test_identifica_apenas_aluno_vinculado_e_encerra_acesso_tutora(self):
        ana=self.api('/api/alunos',{'nome':'Ana fictícia','perfil_acessibilidade':'baixa_visao','foto':self.foto('red'),'autorizado':True})
        outro=self.api('/api/alunos',{'nome':'Outro aluno privado','autorizado':True})
        self.vinculo(ana)
        self.vinculo(outro,dispositivo='Sala 2')
        cliente,cookies=self.navegador_aluno()
        contexto=self.chamar(cliente,'/api/aluno/perfil?dispositivo=Sala%202')
        self.assertEqual(contexto['dispositivo'],'Sala 1')
        self.assertEqual(contexto['aluno']['nome'],ana['nome'])
        self.assertEqual(contexto['aluno']['perfil_acessibilidade'],'baixa_visao')
        self.assertNotIn('Outro aluno',json.dumps(contexto))
        self.assertEqual(set(contexto['aluno']),{'id','nome','perfil_acessibilidade','foto_url'})
        self.negar(401,cliente,'/api/alunos')
        self.negar(401,cliente,'/api/comunicadores')
        self.negar(401,cliente,'/api/pedidos')
        self.negar(401,cliente,'/api/sessao')
        self.negar(401,cliente,'/api/aluno/configurar',{'dispositivo':'Sala 2'})
        self.assertEqual(self.api('/api/sessao')['usuario'],'testedev')
        cookie=next(c for c in cookies if c.name=='comunicador_sessao')
        self.assertTrue(cookie.has_nonstandard_attr('HttpOnly'))
        self.assertEqual(cookie.get_nonstandard_attr('SameSite'),'Strict')
        self.assertEqual(cookie.path,'/api/aluno')
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con:
            self.assertNotEqual(con.execute('SELECT token_hash FROM sessoes_comunicador').fetchone()[0],cookie.value)
        with cliente.open(self.url+contexto['aluno']['foto_url']) as resposta:
            self.assertEqual(resposta.headers['Content-Type'],'image/jpeg')
            self.assertEqual(resposta.headers['Cache-Control'],'no-store')
            self.assertEqual(Image.open(BytesIO(resposta.read())).format,'JPEG')
        self.negar(401,build_opener(),contexto['aluno']['foto_url'])
        self.negar(401,cliente,ana['foto_url'])

    def test_atualiza_troca_renomeacao_desativacao_exclusao_e_foto(self):
        ana=self.api('/api/alunos',{'nome':'Ana fictícia','foto':self.foto('red'),'autorizado':True})
        bruno=self.api('/api/alunos',{'nome':'Bruno fictício','autorizado':True})
        self.vinculo(ana)
        cliente,_=self.navegador_aluno()
        original=self.chamar(cliente,'/api/aluno/perfil')
        self.api('/api/alunos/editar',{'id':ana['id'],'versao':1,'nome':'Ana revisada','foto':self.foto('blue'),'autorizado':True})
        novo=self.chamar(cliente,'/api/aluno/perfil')
        self.assertEqual(novo['aluno']['nome'],'Ana revisada')
        self.assertNotEqual(novo['aluno']['foto_url'],original['aluno']['foto_url'])
        self.api('/api/alunos/situacao',{'id':ana['id'],'versao':2,'ativo':False,'confirmado':True})
        contexto=self.chamar(cliente,'/api/aluno/perfil')
        self.assertEqual(contexto['situacao'],'aluno_inativo')
        self.assertIsNone(contexto['aluno'])
        self.negar(404,cliente,original['aluno']['foto_url'])
        self.vinculo(bruno,versao=1)
        self.assertEqual(self.chamar(cliente,'/api/aluno/perfil')['aluno']['id'],bruno['id'])
        self.api('/api/alunos/excluir',{'id':bruno['id'],'versao':1,'confirmacao':bruno['nome']})
        self.assertEqual(self.chamar(cliente,'/api/aluno/perfil'),{'dispositivo':'Sala 1','situacao':'sem_aluno','aluno':None})

    def test_sem_aluno_expiracao_desconexao_e_reinicio(self):
        self.vinculo()
        cliente,_=self.navegador_aluno()
        self.assertEqual(self.chamar(cliente,'/api/aluno/perfil')['situacao'],'sem_aluno')
        # Reinicia de fato o servidor usando o mesmo banco e cookie do navegador.
        import threading
        from servidor import criar_servidor
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server,_=criar_servidor(('127.0.0.1',0),self.pasta)
        self.url='http://127.0.0.1:'+str(self.server.server_port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.assertEqual(self.chamar(cliente,'/api/aluno/perfil')['dispositivo'],'Sala 1')
        self.chamar(cliente,'/api/aluno/desconectar',{})
        self.negar(401,cliente,'/api/aluno/perfil')
        cliente,_=self.navegador_aluno()
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute('UPDATE sessoes_comunicador SET expira=0')
        self.negar(401,cliente,'/api/aluno/perfil')
        self.chamar(cliente,'/api/aluno/desconectar',{})

    def test_catalogo_exige_sessao_aluno_e_preserva_textos_e_pictogramas(self):
        from mensagens import MENSAGENS
        from xml.etree import ElementTree
        from pathlib import Path
        self.vinculo()
        cliente,_=self.navegador_aluno()
        catalogo=self.chamar(cliente,'/api/aluno/catalogo')
        self.assertEqual([c['id'] for c in catalogo['categorias']],['necessidades','sentimentos','conversar'])
        self.assertEqual([len(c['mensagens']) for c in catalogo['categorias']],[4,5,4])
        mensagens=[m for c in catalogo['categorias'] for m in c['mensagens']]+[catalogo['ajuda']]
        por_id={m['id']:m for m in mensagens}
        self.assertEqual(len(por_id),14)
        for chave,definicao in MENSAGENS.items():
            self.assertEqual(por_id[chave]['frase'],definicao['frase'])
        svg=ElementTree.parse(Path(__file__).resolve().parent.parent/'pictogramas.svg')
        icones={no.attrib['id'] for no in svg.findall('.//{http://www.w3.org/2000/svg}symbol')}
        self.assertTrue(all(m['icone'] in icones for m in mensagens))
        self.negar(401,build_opener(),'/api/aluno/catalogo',codigo=self.codigo)
        self.negar(401,self.navegador,'/api/aluno/catalogo')
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_configuracao_e_desconexao_exigem_cabecalho(self):
        self.vinculo()
        cliente,_=self.navegador_aluno()
        for rota in ('/api/aluno/configurar','/api/aluno/desconectar'):
            req=Request(self.url+rota,data=b'{}',headers={'Content-Type':'text/plain'})
            with self.assertRaises(HTTPError) as erro:
                (self.navegador if rota.endswith('configurar') else cliente).open(req)
            self.assertEqual(erro.exception.code,403)
            erro.exception.close()
        self.assertEqual(self.chamar(cliente,'/api/aluno/perfil')['dispositivo'],'Sala 1')


if __name__=='__main__':
    unittest.main()
