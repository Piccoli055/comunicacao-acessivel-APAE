"""Acessos individuais, responsabilidade, autorização e histórico compartilhado."""
from contextlib import closing
from http.cookiejar import CookieJar
import json
import sqlite3
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,build_opener,HTTPCookieProcessor
import test_fluxo


class Tutores(unittest.TestCase):
    setUp=test_fluxo.Fluxo.setUp
    tearDown=test_fluxo.Fluxo.tearDown
    api=test_fluxo.Fluxo.api

    def chamar(self,cliente,rota,dados=None):
        req=Request(self.url+rota,data=None if dados is None else json.dumps(dados).encode(),headers={'X-Portal':'tutora','Content-Type':'application/json'})
        with cliente.open(req,timeout=8) as resposta:return json.load(resposta)

    def negar(self,status,cliente,rota,dados=None):
        with self.assertRaises(HTTPError) as erro:self.chamar(cliente,rota,dados)
        self.assertEqual(erro.exception.code,status)
        erro.exception.close()

    def login(self,usuario='liliane',senha='123',cnpj='164275'):
        cliente=build_opener(HTTPCookieProcessor(CookieJar()))
        perfil=self.chamar(cliente,'/api/login',{'instituicao':cnpj,'usuario':usuario,'senha':senha})
        return cliente,perfil

    def aluno(self,nome):return self.api('/api/alunos',{'nome':nome,'autorizado':True})

    def tutor(self,nome='Liliane',usuario='liliane',alunos=None):
        return self.api('/api/tutores',{'nome':nome,'usuario':usuario,'senha':'123','alunos':alunos or []})

    def enviar(self,aluno,identificador,dispositivo):
        self.api('/api/comunicadores/vincular',{'dispositivo':dispositivo,'aluno_id':aluno['id'],'versao':0})
        self.api('/api/pedidos',{'id':identificador,'frase':'Quero água.','dispositivo':dispositivo},codigo=self.codigo)

    def test_login_exemplo_hash_usuario_instituicao_e_logout(self):
        tutor=self.tutor()
        cliente,perfil=self.login('LILIANE')
        self.assertEqual(perfil['nome'],'Liliane')
        self.assertEqual(perfil['tutor_id'],tutor['id'])
        self.assertEqual(self.chamar(cliente,'/api/sessao'),perfil)
        self.assertNotIn('senha',json.dumps(tutor))
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con:
            sal,resumo=con.execute('SELECT sal,senha_hash FROM tutores').fetchone()
            self.assertNotIn('123',(sal,resumo))
        self.negar(401,build_opener(),'/api/login',{'instituicao':'12345678000190','usuario':'liliane','senha':'123'})
        self.chamar(cliente,'/api/logout',{})
        self.negar(401,cliente,'/api/sessao')
        self.assertEqual(self.api('/api/sessao')['usuario'],'testedev')

    def test_cadastro_exige_admin_e_valida_duplicados_senhas_e_tipos(self):
        tutor=self.tutor();cliente,_=self.login()
        self.negar(403,cliente,'/api/tutores')
        self.negar(403,cliente,'/api/tutores',{'nome':'Outro','usuario':'outro','senha':'123'})
        for dados,status in [({'nome':'Duplicado','usuario':'LILIANE','senha':'123'},409),({'nome':'Reservado','usuario':'testedev','senha':'123'},409),({'nome':'Fraca','usuario':'fraca','senha':'12'},400),({'nome':'','usuario':'vazio','senha':'123'},400)]:
            self.negar(status,self.navegador,'/api/tutores',dados)
        self.assertEqual(len(self.api('/api/tutores')),1)

    def test_pendentes_proprios_historico_todos_e_acoes_protegidas(self):
        ana,bruno=self.aluno('Ana fictícia'),self.aluno('Bruno fictício')
        liliane=self.tutor(alunos=[ana['id']]);outra=self.tutor('Outra tutora','outra',[bruno['id']])
        self.enviar(ana,'da-liliane','Sala 1');self.enviar(bruno,'da-outra','Sala 2')
        cliente,_=self.login()
        todos={p['id']:p for p in self.chamar(cliente,'/api/pedidos')}
        self.assertEqual(set(todos),{'da-liliane','da-outra'})
        self.assertTrue(todos['da-liliane']['meu_pedido'])
        self.assertFalse(todos['da-outra']['meu_pedido'])
        self.assertEqual(todos['da-liliane']['tutores'],[{'id':liliane['id'],'nome':'Liliane'}])
        for rota in ('/api/confirmar','/api/atender'):self.negar(403,cliente,rota,{'id':'da-outra'})
        self.chamar(cliente,'/api/confirmar',{'id':'da-liliane'})
        self.chamar(cliente,'/api/atender',{'id':'da-liliane'})
        self.assertEqual({p['id'] for p in self.chamar(cliente,'/api/pedidos')},{'da-liliane','da-outra'})
        self.assertEqual(next(p for p in self.api('/api/pedidos') if p['id']=='da-outra')['estado'],'novo')

    def test_transferencia_move_pendentes_preserva_atendidos_e_nao_renova_retenção(self):
        aluno=self.aluno('Aluno fictício');primeiro=self.tutor(alunos=[aluno['id']]);segundo=self.tutor('Segunda','segunda')
        self.enviar(aluno,'pendente','Sala 1')
        self.api('/api/pedidos',{'id':'atendido','frase':'Quero água.','dispositivo':'Sala 1'},codigo=self.codigo)
        self.api('/api/confirmar',{'id':'atendido'});self.api('/api/atender',{'id':'atendido'})
        instante=next(p for p in self.api('/api/pedidos') if p['id']=='atendido')['atualizado']
        dados=dict(segundo,alunos=[aluno['id']])
        self.negar(409,self.navegador,'/api/tutores/editar',dados)
        novo=self.api('/api/tutores/editar',dict(dados,confirmar_transferencia=True))
        antes,_=self.login();depois,_=self.login('segunda')
        antigo={p['id']:p for p in self.chamar(antes,'/api/pedidos')};atual={p['id']:p for p in self.chamar(depois,'/api/pedidos')}
        self.assertFalse(antigo['pendente']['meu_pedido']);self.assertTrue(atual['pendente']['meu_pedido'])
        self.assertEqual(atual['atendido']['tutores'][0]['id'],primeiro['id'])
        self.assertEqual(atual['atendido']['atualizado'],instante)
        self.assertEqual(next(t for t in self.api('/api/tutores') if t['id']==primeiro['id'])['alunos'],[])
        self.negar(409,self.navegador,'/api/tutores/editar',dict(segundo,nome='Versão antiga'))

    def test_sem_vinculo_sorteia_uma_vez_e_reenvio_consulta_reinicio_preservam(self):
        aluno=self.aluno('Sem responsável');primeiro=self.tutor();segundo=self.tutor('Segunda','segunda')
        self.api('/api/comunicadores/vincular',{'dispositivo':'Sala livre','aluno_id':aluno['id'],'versao':0})
        corpo={'id':'sorteado','frase':'Quero água.','dispositivo':'Sala livre','tutor_id':primeiro['id']}
        def escolher(candidatos):return next(c for c in candidatos if c[0]==segundo['id'])
        with patch('tutores.secrets.choice',side_effect=escolher) as sorteio:
            self.api('/api/pedidos',corpo,codigo=self.codigo)
            self.api('/api/pedidos',corpo,codigo=self.codigo)
            original=self.api('/api/pedidos')[0]
            self.assertEqual(original['tutores'],[{'id':segundo['id'],'nome':'Segunda'}])
            self.assertEqual(original['encaminhamento'],'aleatorio')
            self.assertEqual(sorteio.call_count,1)
            self.assertEqual(self.api('/api/pedidos')[0],original)
            # Edição de outro tutor não refaz o sorteio do pedido.
            self.api('/api/tutores/editar',dict(primeiro,nome='Primeira revisada'))
            self.assertEqual(sorteio.call_count,1)
        self.server.shutdown();self.server.server_close();self.thread.join()
        from servidor import criar_servidor
        import threading
        self.server,_=criar_servidor(('127.0.0.1',0),self.pasta)
        self.url='http://127.0.0.1:'+str(self.server.server_port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.assertEqual(self.api('/api/pedidos')[0],original)
        cliente,_=self.login('segunda')
        self.assertTrue(self.chamar(cliente,'/api/pedidos')[0]['meu_pedido'])
        outro,_=self.login()
        self.assertFalse(self.chamar(outro,'/api/pedidos')[0]['meu_pedido'])
        self.negar(403,outro,'/api/confirmar',{'id':'sorteado'})

    def test_vinculo_nao_sorteia_e_inativo_nao_desvia_para_outro(self):
        aluno=self.aluno('Com responsável');responsavel=self.tutor(alunos=[aluno['id']]);self.tutor('Segunda','segunda')
        with patch('tutores.secrets.choice') as sorteio:
            self.enviar(aluno,'vinculado','Sala vinculada')
            pedido=self.api('/api/pedidos')[0]
            self.assertEqual(pedido['encaminhamento'],'responsavel')
            self.assertEqual(pedido['tutores'][0]['id'],responsavel['id'])
            self.api('/api/tutores/editar',dict(responsavel,ativo=False))
            self.api('/api/pedidos',{'id':'responsavel-inativo','frase':'Quero água.','dispositivo':'Sala vinculada'},codigo=self.codigo)
            self.assertTrue(all(not p['tutores'] for p in self.api('/api/pedidos')))
            sorteio.assert_not_called()

    def test_sem_tutor_aguarda_admin_e_novo_tutor_distribui_pendente(self):
        aluno=self.aluno('Aluno aguardando');self.enviar(aluno,'aguardando','Sala de espera')
        self.assertEqual(self.api('/api/pedidos')[0]['tutores'],[])
        tutor=self.tutor()
        pedido=self.api('/api/pedidos')[0]
        self.assertEqual(pedido['encaminhamento'],'aleatorio')
        self.assertEqual(pedido['tutores'][0]['id'],tutor['id'])

    def test_sorteio_exclui_inativos_e_desativacao_move_so_pendentes(self):
        aluno=self.aluno('Aluno livre');primeiro=self.tutor();segundo=self.tutor('Segunda','segunda')
        def escolher(candidatos):return next(c for c in candidatos if c[0]==primeiro['id'])
        with patch('tutores.secrets.choice',side_effect=escolher):
            self.enviar(aluno,'aleatorio-pendente','Sala aleatória')
            self.api('/api/pedidos',{'id':'aleatorio-atendido','frase':'Quero água.','dispositivo':'Sala aleatória'},codigo=self.codigo)
        self.api('/api/confirmar',{'id':'aleatorio-atendido'});self.api('/api/atender',{'id':'aleatorio-atendido'})
        atendido=next(p for p in self.api('/api/pedidos') if p['id']=='aleatorio-atendido')
        with patch('tutores.secrets.choice',side_effect=lambda cs:cs[0]) as sorteio:
            self.api('/api/tutores/editar',dict(primeiro,ativo=False))
            for chamada in sorteio.call_args_list:self.assertEqual(chamada.args[0],[(segundo['id'],'Segunda')])
            self.api('/api/pedidos',{'id':'novo-aleatorio','frase':'Quero água.','dispositivo':'Sala aleatória'},codigo=self.codigo)
        pedidos={p['id']:p for p in self.api('/api/pedidos')}
        self.assertEqual(pedidos['aleatorio-atendido'],atendido)
        self.assertEqual(pedidos['aleatorio-pendente']['tutores'][0]['id'],segundo['id'])
        self.assertEqual(pedidos['novo-aleatorio']['tutores'][0]['id'],segundo['id'])
        self.assertEqual(pedidos['aleatorio-pendente']['encaminhamento'],'aleatorio')

    def test_cnpj_real_usa_mesma_instituicao_e_exige_senha_maior(self):
        from acesso import configurar_conta
        configurar_conta(self.pasta/'pedidos.sqlite3','12345678000190','administrador','senha-admin-segura')
        self.navegador,_=self.login('administrador','senha-admin-segura','12.345.678/0001-90')
        self.negar(400,self.navegador,'/api/tutores',{'nome':'Liliane','usuario':'liliane','senha':'123'})
        tutor=self.api('/api/tutores',{'nome':'Liliane','usuario':'liliane','senha':'senha-tutora-segura'})
        cliente,perfil=self.login('liliane','senha-tutora-segura','12345678000190')
        self.assertEqual(perfil['tutor_id'],tutor['id'])
        self.assertEqual(perfil['cnpj'],'12345678000190')
        self.negar(401,build_opener(),'/api/login',{'instituicao':'164275','usuario':'liliane','senha':'senha-tutora-segura'})

    def test_retencao_apaga_responsavel_do_chamado_expirado(self):
        from servidor import limpar_expirados
        from datetime import datetime,timedelta
        aluno=self.aluno('Aluno fictício');self.tutor(alunos=[aluno['id']]);self.enviar(aluno,'retencao','Sala 1')
        self.api('/api/confirmar',{'id':'retencao'});self.api('/api/atender',{'id':'retencao'})
        instante=datetime.fromisoformat(self.api('/api/pedidos')[0]['atualizado'])
        self.assertEqual(limpar_expirados(self.pasta/'pedidos.sqlite3',instante+timedelta(hours=48)),1)
        with closing(sqlite3.connect(self.pasta/'pedidos.sqlite3')) as con:
            self.assertEqual(con.execute('SELECT count(*) FROM pedidos_tutores').fetchone()[0],0)
        self.assertEqual(len(self.api('/api/tutores')),1)

    def test_editar_desativar_e_redefinir_revoga_sessoes(self):
        tutor=self.tutor();cliente,_=self.login()
        novo=self.api('/api/tutores/editar',dict(tutor,nome='Liliane revisada',senha='456'))
        self.negar(401,cliente,'/api/sessao')
        self.negar(401,build_opener(),'/api/login',{'instituicao':'164275','usuario':'liliane','senha':'123'})
        cliente,_=self.login(senha='456')
        inativo=self.api('/api/tutores/editar',dict(novo,ativo=False))
        self.negar(401,cliente,'/api/sessao')
        self.negar(401,build_opener(),'/api/login',{'instituicao':'164275','usuario':'liliane','senha':'456'})
        self.api('/api/tutores/editar',dict(inativo,ativo=True))
        cliente,_=self.login(senha='456')
        from acesso import configurar_conta
        configurar_conta(self.pasta/'pedidos.sqlite3','164275','administrador','senha-segura-123')
        self.negar(401,cliente,'/api/sessao')


if __name__=='__main__':unittest.main()
