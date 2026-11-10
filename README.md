# Comunicador acessível MVP

Projeto local para Raspberry Pi 3 B+ com tela de 480 × 320 e portal no navegador do celular. A interface do Raspberry e o uso com pessoas da APAE ainda precisam de validação no aparelho e com os usuários.

## Iniciar no VS Code com o perfil de testes

No terminal da pasta `comunicador-mvp`, execute:

```powershell
python -m pip install -r requirements.txt
python servidor.py --demo
```

Se o Windows reconhecer apenas o iniciador, use `py servidor.py --demo`.

Abra `http://127.0.0.1:8765` e use:

| Campo | Valor de testes |
| --- | --- |
| Instituição | `51995537839` |
| Usuário | `admdev` |
| Senha | `123456` |
| Perfil | ADM Desenvolvedor |

O código de 11 dígitos é um identificador de testes, não um CNPJ validado. O perfil tem acesso a todas as funções atualmente disponíveis no MVP: pedidos de todos os comunicadores, filtros, recebimento, atendimento e histórico. O cadastro de alunos permite salvar nome, foto opcional e perfil de acessibilidade. A aplicação desses perfis às telas do aluno e os vínculos com comunicadores ficam para as próximas etapas.

`--demo` cria essa conta somente se ainda não existir uma conta configurada. Não substitui uma conta existente. A conta criada permanece no banco local nas próximas execuções. As credenciais acima são públicas e destinadas apenas à demonstração com dados fictícios.

O IP serve para encontrar o servidor. Mudar o IP não muda instituição, usuário ou senha. A sessão expira em oito horas; ao atualizar o navegador, o portal recupera uma sessão ainda válida. Ao sair, a sessão é revogada no servidor.

## Pedidos fictícios

Com o servidor ligado, em outro terminal:

```powershell
python demonstracao.py
```

Isso envia cinco pedidos fictícios de três comunicadores. Cada execução cria pedidos novos. A demonstração usa a credencial dos comunicadores; ela não precisa da senha do portal.

## Configurar ou redefinir uma conta local

Para substituir a conta de demonstração por uma conta configurada pela equipe:

```powershell
python configurar_acesso.py
```

Informe o CNPJ de 14 números, usuário e uma senha de pelo menos 10 caracteres. A senha é digitada de forma oculta e salva somente como derivação PBKDF2 com sal aleatório. O comando substitui a única conta existente e revoga todas as sessões. Não altera os pedidos.

Não há cadastro público nem redefinição por e-mail. A equipe com acesso ao terminal pode usar esse comando para redefinir a conta. Após cinco falhas de login pelo mesmo endereço, novas tentativas ficam bloqueadas por cinco minutos.

## Fluxo de atendimento

1. O pedido chega como **Novo**; ajuda recebe destaque escrito e visual.
2. **Confirmar recebimento** muda para **Recebido**, indicando que a mensagem foi vista.
3. **Marcar como atendido** conclui e o retira da lista de pendentes. Ele permanece consultável no histórico.

Os pendentes aparecem do mais antigo para o mais recente. O histórico lista os chamados em qualquer situação, preservando os pendentes e os atendidos há menos de 48 horas, do mais recente para o mais antigo. Nessa aba há apenas a lista de consulta, com filtros de comunicador, situação (Novo, Recebido ou Atendido) e busca; as ações de atendimento ficam em Pedidos pendentes. Os contadores incluem todos os comunicadores; os filtros afetam a lista.

Ative o aviso sonoro pelo botão do portal. O navegador precisa ficar aberto e o volume deve estar audível. Ative o som novamente após recarregar ou entrar em outra sessão.

O portal atualiza a cada dois segundos e reconecta após uma falha. Se houver foco em uma ação da lista, aparece **Atualizar pedidos**, sem interromper a interação. Uma ação só aparece como concluída depois da confirmação do servidor.

## Cadastro de alunos

Abra **Alunos → Cadastrar novo aluno**, informe nome e perfil de acessibilidade e, se necessário, escolha uma foto. Confirme a autorização institucional e clique em **Salvar cadastro**. O perfil é uma preferência de apresentação, sem registro de diagnóstico; as interfaces por perfil ainda não foram implementadas. Não há vínculo com comunicadores nesta etapa.

A listagem permite **Editar**, substituir ou remover a foto, **Desativar**, **Reativar** e **Excluir**. Desativar mantém os dados para consulta. Excluir exige digitar o nome e remove o cadastro e sua foto do banco ativo. O painel conta todos os alunos cadastrados, ativos e inativos, e atualiza a contagem após alterações e periodicamente.

Fotos aceitas: JPEG, PNG e WebP, até 5 MB, 12 megapixels e 8192 pixels por lado, sem animação. O servidor verifica o conteúdo real, decodifica, corrige orientação, reduz para até 512 × 512 e salva JPEG sem os metadados originais. Fotos ficam no SQLite, acessíveis somente por sessão autenticada e com cache desabilitado. A credencial dos comunicadores não permite consultar fotos nem cadastros. A substituição remove a imagem anterior na mesma transação do cadastro.

### Dados, autorização e exclusão

- Dados mantidos: identificação interna, nome de identificação, foto opcional, perfil de apresentação, situação, datas, versão do cadastro e confirmação de autorização (data e usuário). Não são solicitados CPF, endereço, laudo, e-mail ou data de nascimento.
- A pessoa que cadastra confirma a autorização institucional para o cadastro e a foto. O servidor registra essa confirmação e bloqueia o salvamento sem ela. A instituição mantém a documentação correspondente fora do sistema e define o responsável por autorizar o uso; o checkbox não substitui essa documentação. Na apresentação, utilize cadastros e imagens fictícios.
- Acesso: a única conta de tutora/ADM desta instalação pode consultar e gerenciar todos os alunos. Ainda não existe separação entre várias instituições ou tutoras.
- Retenção: cadastros ativos e inativos permanecem até exclusão explícita. A limpeza de 48 horas é exclusiva dos chamados atendidos, sem apagar alunos ou fotos.
- Retirada da autorização: exclua o cadastro para remover os dados e a foto do banco ativo. Desativar, por si só, não retira esses dados. Nesta etapa os chamados não contêm vínculo com alunos e não são alterados por essa exclusão.
- Não há backup automático. Uma cópia manual de `data/` contém fotos e dados pessoais; deve ficar restrita à equipe responsável. A exclusão do banco ativo não altera cópias externas. Essas cópias devem ser revisadas ao atender uma exclusão, e dados excluídos não devem ser reintroduzidos ao restaurar uma cópia. A política de backups para implantação ainda precisa ser definida com a instituição.

## Exclusão em 48 horas

Cada pedido atendido é excluído 48 horas após o atendimento, registrado no campo `atualizado`. Pedidos novos e recebidos permanecem até serem atendidos, independentemente da idade. Repetir a confirmação ou o atendimento não reinicia a contagem. A limpeza ocorre ao iniciar o servidor, consultar ou alterar pedidos e a cada minuto enquanto estiver ligado. Com o servidor desligado, ocorre na próxima inicialização. Não é uma limpeza geral em horário fixo e não apaga a conta de acesso.

## Acesso pelo celular ou outro computador

Mantenha os aparelhos na mesma rede Wi-Fi. O terminal mostra possíveis endereços, como `http://192.168.1.10:8765`. Abra o endereço da rede do servidor e use a mesma instituição, usuário e senha. Não use `127.0.0.1` no celular para acessar o computador.

Uma nova cópia do projeto em outro PC tem um banco novo porque `data/` não vai para o GitHub. Execute `python servidor.py --demo` para criar o mesmo perfil de testes nessa nova instalação. Não precisa rodar um servidor em cada PC para acessar o portal existente.

Este MVP usa HTTP na rede local. Não exponha a porta no roteador. Ele não inclui acesso público pela internet, APK nem notificações em segundo plano.

## Comunicadores

Escolha um único servidor para reunir todos os pedidos. A credencial de envio aparece no terminal como **Credencial dos comunicadores** e permanece em `data/acesso.txt`. Ela é separada do login e só permite enviar pedidos, sem consultar dados ou atender solicitações.

No Raspberry que também hospeda o servidor:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 01"
```

Nos outros:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 02" --servidor http://IP_DO_SERVIDOR:8765 --codigo CREDENCIAL_DO_COMUNICADOR
```

Use uma identificação diferente por aparelho, com até 80 caracteres. O Raspberry depende de Tkinter e `espeak-ng`/`espeak`; o servidor usa Pillow para validar e normalizar fotos (`python -m pip install -r requirements.txt`). O driver da tela física é configurado separadamente.

## Arquivos principais

- `servidor.py`: API, pedidos, retenção e sessões HTTP.
- `alunos.py`: cadastros, fotos, autorização, edição e desativação/exclusão.
- `requirements.txt`: dependência Pillow usada no servidor.
- `acesso.py`: senha derivada, autenticação, sessão e bloqueio de tentativas.
- `configurar_acesso.py`: configuração e redefinição local da conta.
- `tutora.html`, `portal.css` e `portal.js`: telas e funcionamento do portal.
- `comunicador.py` e `transporte.py`: interface do aluno e fila de envio.
- `demonstracao.py`: exemplos fictícios.
- `tests/test_fluxo.py`: testes de pedidos e autenticação.
- `CHECKLIST_PORTAL.md`: desenvolvimento e validações pendentes.

## Problemas comuns

- **Não conecta:** confirme se o servidor está ligado e abra o endereço dele, não o arquivo HTML ou o Live Server.
- **Credenciais incorretas:** use a conta desta instalação. `--demo` não troca uma conta já configurada; para redefinir, use `configurar_acesso.py`.
- **Endereço em uso:** encerre a execução anterior ou use `python servidor.py --demo --porta 8766`, acessando a nova porta.
- **Página antiga:** execute o servidor na pasta `comunicador-mvp` e atualize o navegador após reiniciar.
- **Sem som:** ative o aviso, confira o volume e mantenha a página aberta.

## Testes

```bash
python -m unittest discover -s tests -v
```

A suíte verifica login, rejeição de credenciais, expiração e revogação de sessão, limite de tentativas, credenciais separadas dos comunicadores, estados de pedidos, retenção de 48 horas, persistência, migração e reenvio sem duplicação.

O cadastro foi ensaiado no Edge em larguras de computador e celular com banco temporário e dados fictícios. Ainda faltam celular real, áudio, leitor de tela, Raspberry físico e ensaio na rede da apresentação. Adaptações das interfaces e vínculos com comunicadores são próximas etapas.
O ensaio de interface em `tests/test_portal_alunos.cjs` usa Playwright e inicia um servidor com banco temporário próprio, sem alterar os cadastros da instalação. Para executá-lo, disponibilize o pacote Playwright e seu Chromium e use `node tests/test_portal_alunos.cjs`. Opcionalmente, `PYTHON_TEST` seleciona o executável Python e `TEST_BROWSER=msedge` usa o Edge instalado. As capturas ficam em `tmp/`, fora do Git.
