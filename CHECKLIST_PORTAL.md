# Checklist do portal da tutora

## Definições aprovadas

- [x] Vários comunicadores identificados individualmente.
- [x] Estados Novo, Recebido e Atendido.
- [x] Destaque para pedidos de ajuda.
- [x] Exclusão de cada pedido atendido 48 horas após o atendimento; pendentes permanecem.
- [x] Portal pelo navegador na mesma rede Wi-Fi.

## Implementado e verificado no ambiente local

- [x] Entrada com instituição, usuário e senha; mostrar/ocultar e mensagens de erro.
- [x] Perfil ADM Desenvolvedor de testes, criado com `servidor.py --demo`.
- [x] Sessão com validade de oito horas, saída revogável e limite de tentativas.
- [x] Credencial dos comunicadores separada do acesso ao portal.
- [x] Lista de pendentes e histórico com pendentes e chamados atendidos há menos de 48 horas.
- [x] Histórico somente para consulta, sem cartões de resumo ou ações, com filtros por comunicador e situação e busca.
- [x] Identificação, mensagem, horário, situação e ações.
- [x] Contadores por situação.
- [x] Filtros por comunicador e situação; busca textual.
- [x] Ajuda destacada por texto e cor.
- [x] Layout para computador e largura de celular, sem rolagem horizontal.
- [x] Campos identificados, foco visível e atualização sem interromper o foco na lista.
- [x] Estados de vazio e busca sem resultados.
- [x] Aviso visual de novos pedidos e ativação opcional de som.
- [x] Atualização a cada dois segundos e reconexão automática.
- [x] Aviso de perda de conexão preservando dados já carregados.
- [x] Ações confirmadas pelo servidor antes de mudar a situação na tela.
- [x] Persistência, prevenção de duplicação e preservação de confirmações antigas.
- [x] Exclusão em 48 horas verificada com relógio controlado nos testes.
- [x] Proteção das consultas e ações por sessão; credencial do comunicador permite apenas enviar pedidos.
- [x] Saída revoga a sessão no servidor e remove dados da tela.
- [x] Instruções de execução, acesso no celular e solução de problemas.
- [x] Gerador manual de pedidos fictícios para o ensaio.
- [x] Testes automáticos de autenticação e pedidos implementados.

## Cadastro de alunos — execução por etapas

- [x] Criar tabela de alunos no SQLite, com identificação, nome, referência da foto, perfil de acessibilidade, situação ativa e datas.
- [x] Criar listagem de alunos: menu, nome, perfil, situação, carregamento, estado vazio e atualização manual; API protegida por sessão.
- [x] Criar formulário com nome obrigatório, foto opcional, prévia e seleção do perfil de acessibilidade.
- [x] Implementar upload, substituição e remoção da foto; validar tamanho, formato real, integridade e dimensões no servidor; remover metadados e proteger a consulta por sessão.
- [x] Salvar e editar os dados pela interface, preservando cadastros após reiniciar e evitando sobrescrever edições concorrentes.
- [x] Implementar desativação e reativação com confirmação; exclusão definitiva exige digitar o nome.
- [x] Exibir a quantidade de alunos no painel, incluindo ativos e inativos.
- [x] Definir os dados mínimos, registrar a confirmação da autorização institucional com data e usuário e documentar retenção, exclusão e tratamento de cópias externas.

O perfil inicial é padrão; os demais valores representam opções de interface, sem registrar diagnóstico clínico. A tabela não cria alunos automaticamente. A confirmação no formulário não substitui a documentação de autorização mantida pela instituição. Fotos e cadastros foram testados no Edge com banco temporário e dados fictícios, em larguras de computador e celular.

## Próximos desenvolvimentos

- [x] Cadastro, edição e desativação de alunos.
- [ ] Aplicar os perfis às interfaces do aluno e personalizar mensagens; seleção do perfil no cadastro já disponível.
- [ ] Vínculo entre aluno e comunicador.
- [ ] Identificação do aluno nos pedidos.

## Validação que depende dos aparelhos e da equipe

- [ ] Validar visualmente o novo formulário de instituição, usuário e senha.
- [ ] Testar no celular real da tutora, incluindo toque, zoom e navegador escolhido.
- [ ] Confirmar som audível e comportamento com economia de energia/bloqueio de tela.
- [ ] Avaliar a navegação com leitor de tela no celular real.
- [ ] Enviar pedidos pelo Raspberry Pi 3 B+ e tela física.
- [ ] Testar vários comunicadores físicos na mesma rede.
- [ ] Fazer ensaio na rede do local da apresentação.
- [ ] Revisar mensagens e usabilidade com a equipe; para uso real, com tutoras e usuários da APAE.

O software local foi preparado para o MVP. A conclusão da validação exige os testes acima; a simulação do navegador não substitui o celular e o Raspberry reais.
