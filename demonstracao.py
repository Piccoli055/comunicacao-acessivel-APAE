"""Execute manualmente para enviar exemplos fictícios ao portal local."""
import argparse
import json
from pathlib import Path
import uuid
from urllib.error import URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--servidor', default='http://127.0.0.1:8765')
    args = parser.parse_args()
    arquivo = Path(__file__).resolve().parent / 'data' / 'acesso.txt'
    try:
        codigo = arquivo.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        parser.exit(1, 'Inicie servidor.py nesta pasta antes de gerar os exemplos.\n')
    exemplos = [('Comunicador 01', 'Quero beber água.'), ('Comunicador 02', 'Preciso de ajuda.'),
                ('Comunicador 03', 'Preciso ir ao banheiro.'), ('Comunicador 01', 'Estou feliz.'),
                ('Comunicador 02', 'Preciso descansar.')]
    enviados = 0
    try:
        for dispositivo, frase in exemplos:
            dados = {'id': 'demo-' + str(uuid.uuid4()), 'dispositivo': dispositivo, 'frase': frase}
            req = Request(args.servidor.rstrip('/') + '/api/pedidos', data=json.dumps(dados).encode('utf-8'),
                          headers={'X-Codigo': codigo, 'Content-Type': 'application/json'})
            with urlopen(req, timeout=5) as resposta:
                if not json.load(resposta).get('ok'):
                    raise ValueError('Resposta inesperada do servidor.')
            enviados += 1
    except (URLError, ValueError) as erro:
        parser.exit(1, f'Foram enviados {enviados} exemplos antes da falha. Confira o servidor e a porta. Detalhe: {erro}\n')
    print(f'{enviados} pedidos fictícios enviados de três comunicadores. Abra o portal para acompanhar.')


if __name__ == '__main__':
    main()
