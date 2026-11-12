"""Grade protegida e seleção de aluno independente por navegador."""
from contextlib import closing
from http.cookiejar import CookieJar
from io import BytesIO
import base64
import json
import sqlite3
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor
from PIL import Image
import test_fluxo


class EntradaAlunos(unittest.TestCase):
    setUp=test_fluxo.Fluxo.setUp
    tearDown=test_fluxo.Fluxo.tearDown
    api=test_fluxo.Fluxo.api

    def chamar(self,cliente,rota,dados=None,codigo=None):
        headers={'X-Portal':'aluno','Content-Type':'application/json'}
        if codigo:headers['X-Codigo']=codigo
        req=Request(self.url+rota,data=None if dados is None else json.dumps(dados).encode(),headers=headers)
        with cliente.open(req,timeout=8) as resposta:return json.load(resposta)

    def negar(self,status,cliente,rota,dados=None,codigo=None):
        with self.assertRaises(HTTPError) as erro:self.chamar(cliente,rota,dados,codigo)
        self.assertEqual(erro.exception.code,status)
        erro.exception.close()

    def liberar(self):
        cliente=build_opener(HTTPCookieProcessor(CookieJar()))
        req=Request(self.url+'/api/login',data=json.dumps({'instituicao':'164275','usuario':'testedev','senha':'123456'}).encode(),headers={'X-Portal':'tutora','Content-Type':'application/json'})
        with cliente.open(req,timeout=8) as resposta:json.load(resposta)
        self.chamar(cliente,'/api/aluno/liberar',{})
        return cliente

    def aluno(self,nome='Aluno fictício',perfil='padrao',foto=False):
        dados={'nome':nome,'perfil_acessibilidade':perfil,'autorizado':True}
        if foto:
            b=BytesIO();Image.new('RGB',(40,40),'teal').save(b,format='PNG');dados['foto']=base64.b64encode(b.getvalue()).decode()
        return self.api('/api/alunos',dados)

    def test_grade_fotos_e_selecao_nao_sao_publicas(self):
        aluno=self.aluno(foto=True)
        visitante=build_opener()
        for codigo in (None,self.codigo):
            self.negar(401,visitante,'/api/aluno/entrada',codigo=codigo)
            self.negar(401,visitante,'/api/aluno/selecionar',{'aluno_id':aluno['id']},codigo)
        self.negar(401,visitante,'/api/aluno/liberar',{})
        self.negar(401,self.navegador,'/api/aluno/entrada')
        cliente=self.liberar()
        entrada=self.chamar(cliente,'/api/aluno/entrada')
        self.assertEqual(entrada[0]['nome'],aluno['nome'])
        self.assertEqual(set(entrada[0]),{'id','nome','perfil_acessibilidade','tag','foto_url'})
        self.negar(401,visitante,entrada[0]['foto_url'])
        with cliente.open(self.url+entrada[0]['foto_url']) as resposta:
            self.assertEqual(resposta.headers['Content-Type'],'image/jpeg')
            self.assertEqual(resposta.headers['Cache-Control'],'no-store')
        for rota in ('/api/alunos','/api/pedidos','/api/comunicadores','/api/sessao'):
            self.negar(401,cliente,rota)
        self.assertEqual(self.api('/api/sessao')['usuario'],'testedev')

    def test_tags_tipos_cores_e_alunos_inativos(self):
        esperados={'padrao':('Padrão','neutro'),'tea':('TEA','azul'),'motora':('Acessibilidade motora','roxo'),'baixa_visao':('Baixa visão','ambar'),'intelectual':('Acessibilidade cognitiva','verde')}
        for perfil in esperados:self.aluno(perfil,perfil)
        inativo=self.aluno('Aluno inativo')
        self.api('/api/alunos/situacao',{'id':inativo['id'],'versao':1,'ativo':False,'confirmado':True})
        lista=self.chamar(self.liberar(),'/api/aluno/entrada')
        self.assertEqual(len(lista),5)
        for aluno in lista:
            nome,cor=esperados[aluno['perfil_acessibilidade']]
            self.assertEqual(aluno['tag'],{'rotulo':nome,'cor':cor})

    def test_selecao_nao_altera_vinculos_nem_outro_navegador(self):
        ana=self.aluno('Ana fictícia');bruno=self.aluno('Bruno fictício')
        self.api('/api/comunicadores/vincular',{'dispositivo':'Aparelho físico','aluno_id':ana['id'],'versao':0})
        primeiro,segundo=self.liberar(),self.liberar()
        self.chamar(primeiro,'/api/aluno/selecionar',{'aluno_id':ana['id']})
        self.chamar(segundo,'/api/aluno/selecionar',{'aluno_id':bruno['id']})
        self.assertEqual(self.chamar(primeiro,'/api/aluno/perfil')['aluno']['id'],ana['id'])
        self.assertEqual(self.chamar(segundo,'/api/aluno/perfil')['aluno']['id'],bruno['id'])
        self.chamar(primeiro,'/api/aluno/desconectar',{})
        self.assertEqual(len(self.chamar(primeiro,'/api/aluno/entrada')),2)
        self.chamar(primeiro,'/api/aluno/selecionar',{'aluno_id':bruno['id']})
        self.assertEqual(self.api('/api/comunicadores')[0]['aluno_id'],ana['id'])
        self.assertEqual(self.api('/api/pedidos'),[])

    def test_inativar_excluir_e_expirar_revoga_dados_da_grade(self):
        aluno=self.aluno(foto=True);cliente=self.liberar()
        foto=self.chamar(cliente,'/api/aluno/entrada')[0]['foto_url']
        self.chamar(cliente,'/api/aluno/selecionar',{'aluno_id':aluno['id']})
        self.api('/api/alunos/situacao',{'id':aluno['id'],'versao':1,'ativo':False,'confirmado':True})
        self.assertEqual(self.chamar(cliente,'/api/aluno/entrada'),[])
        self.assertIsNone(self.chamar(cliente,'/api/aluno/perfil')['aluno'])
        self.negar(404,cliente,foto)
        self.negar(409,cliente,'/api/aluno/selecionar',{'aluno_id':aluno['id']})
        self.negar(409,cliente,'/api/aluno/selecionar',{'aluno_id':'inexistente'})
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con, con:
            con.execute('UPDATE sessoes_entrada SET expira=0')
        self.negar(401,cliente,'/api/aluno/entrada')
        self.negar(401,cliente,foto)
        self.negar(401,cliente,'/api/aluno/selecionar',{'aluno_id':aluno['id']})


if __name__=='__main__':unittest.main()
