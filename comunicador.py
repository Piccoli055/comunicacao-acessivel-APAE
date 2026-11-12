"""Interface de demonstração para tela 480 × 320."""
import argparse
import base64
import platform
import queue
import shutil
import subprocess
import threading
import uuid
import tkinter as tk
from pathlib import Path

from transporte import Fila
from mensagens import MENSAGENS, opcao_mensagem

ROOT = Path(__file__).resolve().parent
GRUPOS = {
    'Necessidades': [opcao_mensagem(identificador) for identificador in ('agua','comida','banheiro','descanso')],
    'Sentimentos': [opcao_mensagem('mal_estar'), ('Feliz', 'Estou feliz.', 'feliz'), ('Triste', 'Estou triste.', 'triste'),
                    ('Dor', 'Estou sentindo dor.', 'dor'), ('Medo', 'Estou com medo.', 'medo')],
    'Conversar': [('Sim', 'Sim.', 'sim'), ('Não', 'Não.', 'nao'),
                  ('Obrigado', 'Obrigado.', 'feliz'), ('De novo', 'Pode repetir, por favor?', 'repetir')],
}
COR = '#153a4b'


def falar(frase):
    if platform.system() == 'Windows':
        # A frase vira uma string literal do PowerShell, nunca um comando.
        literal = "'" + frase.replace("'", "''") + "'"
        script = ("Add-Type -AssemblyName System.Speech; "
                  "$voz = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                  "try {$voz.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, "
                  "[System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'))} catch {}; "
                  "$voz.Speak(" + literal + ")")
        return ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand',
                base64.b64encode(script.encode('utf-16le')).decode('ascii')]
    programa = shutil.which('espeak-ng') or shutil.which('espeak')
    return [programa, '-v', 'pt-br', frase] if programa else None


def icone(c, nome):
    def linha(*p): c.create_line(*p, fill=COR, width=3, capstyle='round', joinstyle='round')
    def oval(*p): c.create_oval(*p, outline=COR, width=3)
    def ret(*p): c.create_rectangle(*p, outline=COR, width=3)
    if nome == 'agua':
        linha(12, 14, 18, 48, 42, 48, 48, 14, 12, 14); linha(17, 29, 43, 29)
    elif nome == 'comida':
        oval(15, 12, 49, 46); linha(7, 10, 7, 49); linha(56, 10, 56, 49)
    elif nome == 'banheiro':
        ret(9, 8, 25, 27); linha(14, 29, 49, 29, 45, 40, 28, 40, 28, 49, 43, 49); linha(19, 27, 19, 37, 28, 40)
    elif nome == 'descanso':
        linha(8, 12, 8, 49); linha(8, 36, 53, 36, 53, 49); ret(12, 26, 23, 35); linha(24, 26, 49, 26, 53, 36)
    elif nome == 'sim': linha(10, 29, 24, 43, 51, 13)
    elif nome == 'nao': linha(14, 12, 47, 46); linha(47, 12, 14, 46)
    elif nome in ('feliz', 'triste', 'medo'):
        oval(10, 8, 50, 49); oval(20, 20, 22, 22); oval(38, 20, 40, 22)
        if nome == 'medo': oval(25, 31, 35, 42)
        elif nome == 'feliz': linha(21, 34, 30, 40, 40, 34)
        else: linha(21, 40, 30, 34, 40, 40)
    elif nome in ('ajuda', 'dor'):
        ret(12, 10, 49, 48); linha(30, 17, 30, 40); linha(19, 29, 42, 29)
    else:
        linha(13, 19, 24, 10, 44, 12, 50, 25, 44, 42, 24, 45, 14, 35); linha(13, 19, 13, 7); linha(13, 19, 25, 19)


class Comunicador:
    def __init__(self, janela, args):
        self.janela, self.args = janela, args
        self.eventos = queue.Queue()
        self.parar = threading.Event()
        self.fila = Fila(ROOT / 'data' / 'fila.sqlite3')
        self.grupo = None
        self.pagina = 0
        self.confirmacao = None
        self.frase_confirmada = None
        self.enviando = False
        janela.title('Comunicador · MVP')
        janela.geometry('480x320')
        janela.resizable(False, False)
        janela.configure(bg='#eff4f6')
        janela.attributes('-fullscreen', args.tela_cheia)
        janela.bind('<Escape>', lambda _: janela.attributes('-fullscreen', False))
        janela.protocol('WM_DELETE_WINDOW', self.fechar)
        topo = tk.Frame(janela, bg=COR, height=48)
        topo.pack(fill='x'); topo.pack_propagate(False)
        tk.Button(topo, text='‹ Início', command=self.inicio, bg=COR, fg='white',
                  relief='flat', font=('DejaVu Sans', 12)).pack(side='left', padx=4)
        self.titulo = tk.Label(topo, bg=COR, fg='white', font=('DejaVu Sans', 14, 'bold'))
        self.titulo.pack(side='left', padx=8)
        self.navegacao = tk.Frame(topo, bg=COR)
        self.navegacao.pack(side='right', padx=4)
        self.corpo = tk.Frame(janela, bg='#eff4f6')
        self.corpo.pack(fill='both', expand=True, padx=8, pady=6)
        self.status = tk.Label(janela, text='Escolha uma categoria', bg='#eff4f6', fg=COR,
                               font=('DejaVu Sans', 10), wraplength=460, height=2)
        self.status.pack(fill='x', padx=6, pady=(0, 3))
        self.inicio()
        threading.Thread(target=self.sincronizar, daemon=True).start()
        janela.after(150, self.receber_eventos)

    def limpar(self, titulo):
        self.confirmacao = None
        self.frase_confirmada = None
        self.titulo.config(text=titulo)
        for filho in self.navegacao.winfo_children(): filho.destroy()
        for filho in self.corpo.winfo_children(): filho.destroy()

    def grade(self, itens):
        for i in range(2):
            self.corpo.rowconfigure(i, weight=1, uniform='linha')
            self.corpo.columnconfigure(i, weight=1, uniform='coluna')
        for i, (rotulo, desenho, acao) in enumerate(itens):
            tile = tk.Frame(self.corpo, bg='white', highlightbackground='#91a9b5', highlightthickness=1)
            tile.grid(row=i // 2, column=i % 2, sticky='nsew', padx=4, pady=4)
            c = tk.Canvas(tile, width=62, height=56, bg='white', highlightthickness=0)
            c.pack(side='left', padx=(4, 0)); icone(c, desenho)
            b = tk.Button(tile, text=rotulo, command=acao, bg='white', fg=COR, activebackground='#d5eaf0',
                          relief='flat', wraplength=138, font=('DejaVu Sans', 13, 'bold'), takefocus=True)
            b.pack(side='left', fill='both', expand=True)
            c.bind('<Button-1>', lambda _, fn=acao: fn())
            tile.bind('<Button-1>', lambda _, fn=acao: fn())

    def inicio(self):
        self.grupo = None
        self.pagina = 0
        self.limpar('Como posso ajudar?')
        self.grade([('Necessidades', 'agua', lambda: self.categoria('Necessidades')),
                    ('Sentimentos', 'feliz', lambda: self.categoria('Sentimentos')),
                    ('Conversar', 'repetir', lambda: self.categoria('Conversar')),
                    ('Ajuda', 'ajuda', lambda: self.confirmar(MENSAGENS['ajuda']['frase']))])

    def categoria(self, nome, pagina=0):
        itens = GRUPOS[nome]
        paginas = (len(itens) + 3) // 4
        self.grupo = nome
        self.pagina = max(0, min(pagina, paginas - 1))
        self.limpar(nome)
        if self.pagina > 0:
            tk.Button(self.navegacao, text='‹ Anterior', bg=COR, fg='white',
                      relief='flat', font=('DejaVu Sans', 10),
                      command=lambda: self.categoria(nome, self.pagina - 1)).pack(side='left')
        if self.pagina < paginas - 1:
            tk.Button(self.navegacao, text='Mais ›', bg=COR, fg='white',
                      relief='flat', font=('DejaVu Sans', 10),
                      command=lambda: self.categoria(nome, self.pagina + 1)).pack(side='left')
        self.grade([(titulo, desenho, lambda f=frase: self.confirmar(f))
                    for titulo, frase, desenho in itens[self.pagina * 4:(self.pagina + 1) * 4]])
        texto = f'Página {self.pagina + 1} de {paginas}. Escolha uma mensagem.' if paginas > 1 else 'Escolha uma mensagem.'
        self.status.config(text=texto)

    def confirmar(self, frase):
        self.limpar('Enviar esta mensagem?')
        token = uuid.uuid4().hex
        self.confirmacao = token
        self.frase_confirmada = frase
        tk.Label(self.corpo, text=frase, font=('DejaVu Sans', 23, 'bold'), fg=COR,
                 bg='#eff4f6', wraplength=440).pack(expand=True, fill='both')
        botoes = tk.Frame(self.corpo, bg='#eff4f6'); botoes.pack(fill='x', pady=8)
        tk.Button(botoes, text='Voltar', font=('DejaVu Sans', 16), height=2,
                  command=lambda: self.categoria(self.grupo, self.pagina) if self.grupo else self.inicio()).pack(side='left', fill='x', expand=True, padx=4)
        self.botao_enviar = tk.Button(botoes, text='Falar e enviar', bg='#125a6b', fg='white', font=('DejaVu Sans', 16, 'bold'),
                  height=2, command=lambda: self.enviar(frase, token))
        self.botao_enviar.pack(side='left', fill='x', expand=True, padx=4)

    def enviar(self, frase, token):
        # Uma confirmação é consumida uma única vez, inclusive por callbacks antigos.
        if self.enviando or token != self.confirmacao or frase != self.frase_confirmada:
            return False
        self.enviando = True
        self.botao_enviar.config(state='disabled')
        try:
            self.fila.adicionar(frase, self.args.dispositivo, identificador=token)
        except Exception:
            self.status.config(text='Não foi possível guardar o pedido. Tente novamente.')
            self.botao_enviar.config(state='normal')
            return False
        finally:
            self.enviando = False
        self.inicio()
        self.status.config(text='Pedido guardado. Aguardando envio à tutora.')
        threading.Thread(target=self.audio, args=(frase,), daemon=True).start()
        return True

    def audio(self, frase):
        comando = falar(frase)
        if not comando:
            self.eventos.put('Voz indisponível. O envio continua funcionando.')
            return
        try:
            subprocess.run(comando, check=True, timeout=25, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=0x08000000 if platform.system() == 'Windows' else 0)
        except (OSError, subprocess.SubprocessError):
            self.eventos.put('Não foi possível reproduzir o áudio.')

    def sincronizar(self):
        while not self.parar.is_set():
            try:
                if self.fila.pendentes():
                    codigo = self.args.codigo or (ROOT / 'data' / 'acesso.txt').read_text(encoding='utf-8').strip()
                    self.fila.enviar(self.args.servidor, codigo)
                    self.eventos.put('Pedido(s) enviado(s) à tutora.')
            except Exception:
                self.eventos.put('Não foi possível verificar o envio. Tentaremos novamente…')
            self.parar.wait(2)

    def receber_eventos(self):
        try:
            while True: self.status.config(text=self.eventos.get_nowait())
        except queue.Empty:
            pass
        self.janela.after(150, self.receber_eventos)

    def fechar(self):
        self.parar.set()
        self.janela.destroy()


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--tela-cheia', action='store_true')
    p.add_argument('--servidor', default='http://127.0.0.1:8765')
    p.add_argument('--codigo', default='')
    p.add_argument('--dispositivo', default='MVP', help='Identificação única deste comunicador (até 80 caracteres).')
    args = p.parse_args()
    if not 1 <= len(args.dispositivo.strip()) <= 80:
        p.error('A identificação do comunicador deve ter entre 1 e 80 caracteres.')
    app = tk.Tk()
    Comunicador(app, args)
    app.mainloop()
