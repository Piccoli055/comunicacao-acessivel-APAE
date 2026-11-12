"""Navegação real do Tkinter, com banco temporário e sem reproduzir áudio."""
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import tkinter as tk
import unittest
from unittest.mock import patch

import comunicador


class TelaComunicador(unittest.TestCase):
    def setUp(self):
        try:
            self.janela = tk.Tk()
        except tk.TclError as erro:
            self.skipTest('Tkinter indisponível neste ambiente: ' + str(erro))
        self.janela.withdraw()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        raiz = patch.object(comunicador,'ROOT',Path(self.temp.name))
        raiz.start()
        self.addCleanup(raiz.stop)
        with patch.object(comunicador.Comunicador,'sincronizar',lambda self: None):
            self.app = comunicador.Comunicador(self.janela,SimpleNamespace(tela_cheia=False,dispositivo='Teste',servidor='http://127.0.0.1:1',codigo=''))
        self.addCleanup(self.app.fechar)

    def botoes(self, widget):
        lista = []
        for filho in widget.winfo_children():
            if isinstance(filho,tk.Button):
                lista.append(filho)
            lista.extend(self.botoes(filho))
        return lista

    def clicar(self, widget, texto):
        next(b for b in self.botoes(widget) if b.cget('text')==texto).invoke()

    def test_paginacao_preserva_opcoes_e_volta_para_pagina_da_confirmacao(self):
        self.app.categoria('Sentimentos')
        self.assertEqual(len(self.app.corpo.winfo_children()),4)
        self.assertIn('Não estou bem',[b.cget('text') for b in self.botoes(self.app.corpo)])
        self.clicar(self.app.navegacao,'Mais ›')
        self.assertEqual(self.app.pagina,1)
        self.clicar(self.app.corpo,'Medo')
        self.clicar(self.app.corpo,'Voltar')
        self.assertEqual(self.app.pagina,1)
        self.assertIn('Medo',[b.cget('text') for b in self.botoes(self.app.corpo)])
        self.clicar(self.app.navegacao,'‹ Anterior')
        self.assertEqual(self.app.pagina,0)
        self.assertEqual(len(self.app.corpo.winfo_children()),4)
        self.app.inicio()
        self.assertEqual(self.app.navegacao.winfo_children(),[])

    def test_mal_estar_pede_confirmacao_e_envia_mesma_frase_para_fila_e_voz(self):
        self.app.categoria('Sentimentos')
        self.clicar(self.app.corpo,'Não estou bem')
        self.assertEqual(self.app.fila.pendentes(),[])
        frases = [w.cget('text') for w in self.app.corpo.winfo_children() if isinstance(w,tk.Label)]
        self.assertEqual(frases,['Não estou bem.'])
        gravado = threading.Event()
        falas = []
        def audio(frase):
            falas.append(frase)
            gravado.set()
        with patch.object(self.app,'audio',audio):
            self.clicar(self.app.corpo,'Falar e enviar')
            self.assertTrue(gravado.wait(2))
        self.assertEqual(falas,['Não estou bem.'])
        pedidos = self.app.fila.pendentes()
        self.assertEqual(len(pedidos),1)
        self.assertEqual((pedidos[0]['frase'],pedidos[0]['dispositivo']),('Não estou bem.','Teste'))
        self.assertIsNone(self.app.grupo)

    def test_seis_mensagens_usam_mesmo_texto_na_confirmacao_fila_e_voz(self):
        from mensagens import MENSAGENS
        esperadas = {
            'agua':'Quero água.', 'banheiro':'Quero ir ao banheiro.',
            'ajuda':'Preciso de ajuda.', 'mal_estar':'Não estou bem.',
            'comida':'Estou com fome.', 'descanso':'Quero descansar.',
        }
        for identificador,frase in esperadas.items():
            with self.subTest(mensagem=identificador):
                self.app.inicio()
                if identificador in ('agua','banheiro','comida','descanso'):
                    self.clicar(self.app.corpo,'Necessidades')
                elif identificador=='mal_estar':
                    self.clicar(self.app.corpo,'Sentimentos')
                self.clicar(self.app.corpo,MENSAGENS[identificador]['rotulo'])
                textos = [w.cget('text') for w in self.app.corpo.winfo_children() if isinstance(w,tk.Label)]
                self.assertEqual(textos,[frase])
                gravado = threading.Event()
                falas = []
                def audio(texto):
                    falas.append(texto)
                    gravado.set()
                with patch.object(self.app,'audio',audio):
                    self.clicar(self.app.corpo,'Falar e enviar')
                    self.assertTrue(gravado.wait(2))
                self.assertEqual(falas,[frase])
                self.assertEqual(self.app.fila.pendentes()[-1]['frase'],frase)
        self.assertEqual(len(self.app.fila.pendentes()),6)

    def test_toques_repetidos_e_retry_apos_falha_nao_duplicam_confirmacao(self):
        frase = 'Preciso de ajuda.'
        self.app.confirmar(frase)
        token = self.app.confirmacao
        original = self.app.fila.adicionar
        def falha_apos_gravar(*args, **kwargs):
            self.assertEqual(str(self.app.botao_enviar.cget('state')),'disabled')
            self.assertFalse(self.app.enviar(frase,token))
            original(*args, **kwargs)
            raise OSError('Falha simulada depois de persistir')
        with patch.object(self.app.fila,'adicionar',side_effect=falha_apos_gravar):
            self.assertFalse(self.app.enviar(frase,token))
        self.assertEqual(str(self.app.botao_enviar.cget('state')),'normal')
        gravado = threading.Event()
        with patch.object(self.app,'audio',lambda _: gravado.set()):
            self.assertTrue(self.app.enviar(frase,token))
            self.assertTrue(gravado.wait(2))
            self.assertFalse(self.app.enviar(frase,token))
            self.assertEqual(len(self.app.fila.pendentes()),1)
            # Uma nova confirmação da mesma frase continua permitida.
            self.app.confirmar(frase)
            novo_token = self.app.confirmacao
            self.assertNotEqual(novo_token,token)
            self.assertTrue(self.app.enviar(frase,novo_token))
        self.assertEqual(len(self.app.fila.pendentes()),2)

    def test_confirmacao_cancelada_nao_pode_enviar_por_callback_antigo(self):
        self.app.confirmar('Quero água.')
        token = self.app.confirmacao
        self.app.inicio()
        self.assertFalse(self.app.enviar('Quero água.',token))
        self.assertEqual(self.app.fila.pendentes(),[])

    def test_falha_temporaria_da_fila_nao_encerra_sincronizacao(self):
        rodadas = []
        def proxima(_):
            rodadas.append(True)
            if len(rodadas) == 2:
                self.app.parar.set()
            return False
        with patch.object(self.app.fila,'pendentes',side_effect=[OSError('ocupado'),[]]), patch.object(self.app.parar,'wait',side_effect=proxima):
            self.app.sincronizar()
        self.assertEqual(len(rodadas),2)
        self.assertIn('Tentaremos novamente',self.app.eventos.get_nowait())

    def test_paginas_e_confirmacao_cabem_na_area_solicitada(self):
        for pagina in (0,1):
            self.app.categoria('Sentimentos',pagina)
            self.janela.update_idletasks()
            self.assertLessEqual(self.janela.winfo_reqwidth(),480)
            self.assertLessEqual(self.janela.winfo_reqheight(),320)
            self.assertTrue(all(int(w.grid_info()['row'])<2 for w in self.app.corpo.winfo_children()))
        self.app.confirmar('Não estou bem.')
        self.janela.update_idletasks()
        self.assertLessEqual(self.janela.winfo_reqwidth(),480)
        self.assertLessEqual(self.janela.winfo_reqheight(),320)


if __name__ == '__main__':
    unittest.main()
