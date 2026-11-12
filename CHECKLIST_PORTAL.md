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
- [x] Histórico somente para consulta, sem cartões de resumo ou ações, com filtros por aluno, comunicador e situação e busca.
- [x] Identificação, mensagem, horário, situação e ações.
- [x] Contadores por situação.
- [x] Filtros por aluno, comunicador e situação; busca textual por mensagem, nome do aluno ou comunicador.
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

## Vincular alunos aos comunicadores — execução por etapas

- [x] Permitir associar um comunicador a um aluno: tela própria, vínculo persistente, troca e remoção confirmadas, seleção de alunos ativos e API protegida por sessão.
- [x] Registrar a identificação do aluno no chamado: o servidor resolve o vínculo ativo pelo comunicador e salva identificação e nome no recebimento.
- [x] Mostrar nome e foto atual do aluno nos pedidos pendentes e no histórico; usar iniciais sem foto e informar quando o aluno não foi identificado.
- [x] Acrescentar filtro por aluno nos pendentes e no histórico, combinado com comunicador, situação e busca; opção para pedidos sem aluno identificado e seleção preservada durante atualizações.
- [x] Preservar identificação e nome registrados no recebimento após renomear/desativar o aluno, trocar/remover vínculos, reenviar ou reiniciar o servidor; anonimizar somente na exclusão definitiva e manter a retenção por atendimento.

Os cinco itens desta etapa foram implementados e verificados, incluindo histórico após alterações do cadastro, troca de aluno no aparelho e reinício real do servidor. O portal usa o nome registrado no recebimento e a foto atual do cadastro; não mantém cópias antigas de fotos. Cada aparelho tem no máximo um aluno vinculado; um aluno pode utilizar vários aparelhos. Alunos inativos continuam identificados como inativos nos vínculos existentes, mas não recebem vínculos novos. Excluir um aluno remove sua identificação dos vínculos e mantém o registro do aparelho. Pedidos novos de aparelhos vinculados registram o aluno ativo no recebimento. Sem vínculo ou com aluno inativo, o chamado continua chegando sem identificação de aluno. Pedidos anteriores não são associados retroativamente. Excluir o cadastro também remove a identificação dos chamados, sem apagar a solicitação nem alterar seu estado ou prazo de retenção.

## Completar chamados e histórico — execução por etapas

- [x] Adicionar “Não estou bem” em Sentimentos, com confirmação, fala e envio pelo fluxo existente. Categorias com mais de quatro opções usam páginas de até quatro botões.
- [x] Revisar as seis mensagens predefinidas e centralizar textos, rótulos e referências de ícone em mensagens.py; usar os mesmos textos na confirmação, fala, envio e demonstração.
- [x] Exibir pictogramas locais das seis solicitações e opções adicionais em pendentes e histórico, reconhecendo os textos anteriores; texto livre usa desenho genérico.
- [x] Mostrar recebimento e atendimento separadamente no histórico; pedidos novos/recebidos indicam Aguardando atendimento.
- [x] Proteger o envio do protótipo contra toques repetidos: botão desabilitado durante a gravação, confirmação consumida uma vez e identificador estável na fila; permitir novo pedido após nova confirmação.
- [x] Testar envio, recebimento, atendimento e histórico.
- [x] Preservar pendentes e excluir atendidos 48 horas após o atendimento.

O item 3 está concluído no software atual. A proteção de toque foi aplicada ao protótipo Tkinter; o futuro portal do aluno no tablet ainda será implementado e deverá conservar a mesma regra de uma solicitação por confirmação. A compreensão dos pictogramas continua sujeita à validação com a equipe.

## Portal do aluno — direcionamento aprovado

- [x] Definir ambos os portais para celular, tablet e PC: tutora com foco em celular/PC e aluno com foco em tablet.
- [x] Identificar o comunicador e carregar o aluno vinculado: configuração pela tutora, acesso restrito por navegador, nome/foto, estados sem vínculo/inativo, atualização e desconexão.
- [ ] Criar o portal do aluno no navegador, com layout responsivo para tablet.
- [x] Aproveitar a área maior para mais opções, mantendo botões amplos e legíveis na primeira versão da navegação.
- [ ] Ajustar quantidade de opções e navegação conforme a orientação da tela e o perfil de acessibilidade.
- [ ] Validar toque, legibilidade e navegação no tablet real.

A interface Tkinter atual de 480 × 320 é um protótipo de demonstração e não define o tamanho do futuro portal do aluno. Não será necessário limitar a interface do tablet a quatro opções por página.

## Próximos desenvolvimentos

- [x] Cadastro, edição e desativação de alunos.
- [ ] Aplicar os perfis às interfaces do aluno e personalizar mensagens; seleção do perfil no cadastro já disponível.
- [x] Configuração do vínculo, registro e exibição da identificação e filtro por aluno no portal.
- [x] Mostrar a identificação e a foto do aluno nos pedidos do portal.

## Validação que depende dos aparelhos e da equipe

- [ ] Validar visualmente o novo formulário de instituição, usuário e senha.
- [ ] Testar no celular real da tutora, incluindo toque, zoom e navegador escolhido.
- [ ] Confirmar som audível e comportamento com economia de energia/bloqueio de tela.
- [ ] Avaliar a navegação com leitor de tela no celular real.
- [ ] Enviar pedidos pelo Raspberry Pi 3 B+ e validar a futura interface no tablet.
- [ ] Testar vários comunicadores físicos na mesma rede.
- [ ] Fazer ensaio na rede do local da apresentação.
- [ ] Revisar mensagens e usabilidade com a equipe; para uso real, com tutoras e usuários da APAE.

O software local foi preparado para o MVP. A conclusão da validação exige os testes acima; a simulação do navegador não substitui o celular e o Raspberry reais.

## Revisão de segurança e consistência — 11/11/2026

- [x] Serializar a contagem de tentativas de login e impedir sessão com senha antiga durante redefinição.
- [x] Exigir proteção do portal também para envio de pedidos autenticado por cookie; manter envio por credencial do comunicador.
- [x] Serializar confirmações e atendimentos para preservar estado e prazo de retenção em ações simultâneas.
- [x] Tratar indisponibilidade do banco sem encerrar o servidor ou a sincronização do protótipo.
- [x] Preservar foco da listagem de alunos em atualizações automáticas e evitar avisos de conexão repetidos sem mudança.
- [x] Impedir que o remetente retire a prioridade da mensagem principal de ajuda.
- [ ] Para implantação real: HTTPS, credenciais individuais dos aparelhos e revisão da capacidade/limites de requisições.

A revisão não certifica ausência de vulnerabilidades. A conclusão do portal do aluno, a aplicação dos perfis e a validação nos aparelhos continuam pendentes. HTTP, conta de demonstração e credencial compartilhada restringem esta versão ao ensaio com dados fictícios em rede de confiança.

## Modo aluno — etapa 1 entregue em 12/11/2026

- [x] Disponibilizar `/aluno` com layout de identificação para celular, tablet e PC.
- [x] Exigir tutora autenticada para configurar um comunicador já cadastrado e encerrar sua sessão administrativa naquele navegador após configurar.
- [x] Carregar exclusivamente o aluno ativo do vínculo atual; foto protegida, iniciais como alternativa e perfil carregado para uso futuro.
- [x] Tratar comunicador sem aluno, cadastro inativo, sessão expirada e falha de conexão.
- [x] Atualizar vínculo e identidade automaticamente enquanto a página estiver visível e permitir atualização manual.
- [x] Permitir desconexão confirmada e revogar a sessão do aluno, preservando o vínculo configurado pela tutora.
- [x] Documentar configuração, funcionamento, restrições e testes no README.

A etapa de identificação não incluiu os botões de comunicação. A apresentação e navegação foram adicionadas na etapa 2 abaixo; confirmação, fala, envio, fila offline web, aplicação dos perfis e bloqueio de saída continuam pendentes. Essas funções seguem como próximos itens, sujeitos à aprovação por etapa.

## Modo aluno — etapa 2: apresentação e navegação

- [x] Manter nome, foto/iniciais e comunicador visíveis na tela de comunicação.
- [x] Apresentar Necessidades, Sentimentos e Conversar e acesso direto a Ajuda.
- [x] Mostrar 14 opções com textos e pictogramas, usando o catálogo do servidor.
- [x] Selecionar uma mensagem, destacar o botão e mostrar a frase escolhida, sem falar ou enviar nesta etapa.
- [x] Voltar ao início, preservar a navegação em mudanças de nome/foto e limpar a seleção na troca de aluno ou perda do acesso.
- [x] Verificar a navegação por teclado e as larguras de celular, tablet e PC no navegador.
- [ ] Revisar o design de cada tela com Eduardo.
- [ ] Implementar confirmação, fala e envio à tutora na próxima etapa.

## Revisão da entrada do aluno — blocos compartilhados

Esta revisão substitui a configuração por identificação digitada como entrada habitual do aluno.

- [x] Alimentar a entrada com todos os alunos ativos cadastrados pela tutora.
- [x] Exibir blocos com foto/iniciais, nome e tag pequena de perfil com texto e cor.
- [x] Usar as cores aprovadas do projeto: TEA azul; motora roxo; baixa visão âmbar; cognitiva verde; padrão cinza.
- [x] Entrar tocando no bloco e oferecer Trocar aluno, sem digitação e sem alterar o vínculo global dos aparelhos.
- [x] Manter as escolhas independentes entre navegadores.
- [x] Restringir a grade e os retratos aos navegadores liberados pela tutora; remover a sessão administrativa após liberar.
- [x] Tratar ausência de cadastros, inatividade, expiração e mudanças feitas pela tutora.
- [x] Testar a grade, tags, fotos, seleção, troca, proteção e responsividade no navegador.

A liberação inicial é feita pela tutora uma vez no navegador compartilhado e dura oito horas. A entrada habitual do aluno é somente pelos blocos. As cores são uma convenção deste projeto; a tag usa o perfil cadastrado, sem representar diagnóstico clínico ou autenticação individual.
