"""Configure localmente o único acesso da tutora. A senha nunca vai ao terminal."""
import argparse
from getpass import getpass
from pathlib import Path
from acesso import configurar_conta, normalizar_cnpj, normalizar_usuario
from servidor import preparar, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dados', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    print('Configuração local do acesso da tutora.')
    print('Se já houver uma conta, ela será substituída e todas as sessões serão encerradas.')
    try:
        cnpj = input('CNPJ da instituição: ').strip()
        normalizar_cnpj(cnpj)
        usuario = input('Nome de usuário: ').strip()
        normalizar_usuario(usuario)
        senha = getpass('Senha (mínimo 10 caracteres; digitação oculta): ')
        confirmacao = getpass('Repita a senha: ')
        if senha != confirmacao:
            raise ValueError('As senhas não coincidem. Nenhuma conta foi alterada.')
        if not 10 <= len(senha) <= 128:
            raise ValueError('A senha deve ter entre 10 e 128 caracteres.')
        db, _ = preparar(args.dados)
        configurar_conta(db, cnpj, usuario, senha)
    except (ValueError, EOFError, KeyboardInterrupt) as erro:
        parser.exit(1, f'Configuração cancelada: {erro}\n')
    print('Acesso configurado. Inicie servidor.py e entre com CNPJ, usuário e senha.')
    print('A conta tem acesso a todas as funções disponíveis no MVP.')


if __name__ == '__main__':
    main()