# Comunicador acessível MVP

Projeto local com servidor no Raspberry Pi 3 B+ ou computador e portal da tutora no navegador. O portal do aluno abre uma grade de alunos ativos, com foto, nome e tag colorida; tocar no próprio bloco abre a comunicação. Os dois portais atendem celular, tablet e PC; o da tutora prioriza celular e PC, e o do aluno prioriza tablet. A tela do aluno já apresenta categorias, pictogramas e seleção de mensagens. Confirmação, fala, envio e adaptações de acessibilidade continuam nas próximas etapas. A interface Tkinter de 480 × 320 é um protótipo de demonstração existente; essa dimensão não limita o futuro portal do aluno. O uso nos aparelhos e com pessoas da APAE ainda precisa de validação.

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
| Instituição | `164275` |
| Usuário | `testedev` |
| Senha | `123456` |
| Perfil | ADM Desenvolvedor |

O código de 6 dígitos é um identificador de testes, não um CNPJ validado. O perfil tem acesso a todas as funções atualmente disponíveis no MVP: pedidos de todos os comunicadores, filtros, recebimento, atendimento e histórico. O cadastro de alunos permite salvar nome, foto opcional e perfil de acessibilidade. A configuração de vínculos com comunicadores já está disponível; o servidor já registra o aluno no chamado. O portal mostra nome e foto nos pedidos; aplicar os perfis às telas do aluno é uma próxima etapa.

`--demo` cria essa conta somente se ainda não existir uma conta configurada. Também atualiza o antigo acesso padrão de testes, revogando suas sessões. Não substitui contas personalizadas. A conta criada permanece no banco local nas próximas execuções. As credenciais acima são públicas e destinadas apenas à demonstração com dados fictícios.

O IP serve para encontrar o servidor. Mudar o IP não muda instituição, usuário ou senha. A sessão expira em oito horas; ao atualizar o navegador, o portal recupera uma sessão ainda válida. Ao sair, a sessão é revogada no servidor.

## Pedidos fictícios

Com o servidor ligado, em outro terminal:

```powershell
python demonstracao.py
```

Isso envia as seis mensagens principais como pedidos fictícios de três comunicadores. Cada execução cria pedidos novos. A demonstração usa a credencial dos comunicadores; ela não precisa da senha do portal.

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

Os pendentes aparecem do mais antigo para o mais recente. O histórico lista os chamados em qualquer situação, preservando os pendentes e os atendidos há menos de 48 horas, do mais recente para o mais antigo. Nessa aba há apenas a lista de consulta, com filtros de aluno, comunicador, situação (Novo, Recebido ou Atendido) e busca; as ações de atendimento ficam em Pedidos pendentes. Os contadores incluem todos os comunicadores; os filtros afetam a lista.

Ative o aviso sonoro pelo botão do portal. O navegador precisa ficar aberto e o volume deve estar audível. Ative o som novamente após recarregar ou entrar em outra sessão.

O portal atualiza a cada dois segundos e reconecta após uma falha. Se houver foco em uma ação da lista, aparece **Atualizar pedidos**, sem interromper a interação. Uma ação só aparece como concluída depois da confirmação do servidor.

Os pedidos e o histórico mostram pictogramas locais junto à mensagem. Os desenhos cobrem as seis mensagens principais, as opções adicionais do protótipo e os textos antigos equivalentes. Mensagens livres desconhecidas recebem o desenho genérico de comunicação; o sistema não classifica uma frase só por conter uma palavra como “água”. Os desenhos não substituem o texto e ainda precisam de avaliação de compreensão com a equipe.

O histórico distingue **Recebimento** e **Atendimento**, com data e hora. Chamados novos ou recebidos mostram **Aguardando atendimento** no segundo campo. Somente os atendidos exibem a data de conclusão, que também define o início da retenção de 48 horas.

## Cadastro de alunos

Abra **Alunos → Cadastrar novo aluno**, informe nome e perfil de acessibilidade e, se necessário, escolha uma foto. Confirme a autorização institucional e clique em **Salvar cadastro**. O perfil é uma preferência de apresentação, sem registro de diagnóstico; as interfaces por perfil ainda não foram implementadas. Os vínculos são configurados na aba Comunicadores; a identificação é registrada pelo servidor e exibida nos pedidos e no histórico.

A listagem permite **Editar**, substituir ou remover a foto, **Desativar**, **Reativar** e **Excluir**. Desativar mantém os dados para consulta. Excluir exige digitar o nome e remove o cadastro e sua foto do banco ativo. O painel conta todos os alunos cadastrados, ativos e inativos, e atualiza a contagem após alterações e periodicamente.

Fotos aceitas: JPEG, PNG e WebP, até 5 MB, 12 megapixels e 8192 pixels por lado, sem animação. O servidor verifica o conteúdo real, decodifica, corrige orientação, reduz para até 512 × 512 e salva JPEG sem os metadados originais. Fotos ficam no SQLite, acessíveis somente por sessão autenticada e com cache desabilitado. A credencial dos comunicadores não permite consultar fotos nem cadastros. A substituição remove a imagem anterior na mesma transação do cadastro.

### Dados, autorização e exclusão

- Dados mantidos: identificação interna, nome de identificação, foto opcional, perfil de apresentação, situação, datas, versão do cadastro, confirmação de autorização (data e usuário) e vínculo com a identificação do aparelho. Não são solicitados CPF, endereço, laudo, e-mail ou data de nascimento.
- A pessoa que cadastra confirma a autorização institucional para o cadastro e a foto. O servidor registra essa confirmação e bloqueia o salvamento sem ela. A instituição mantém a documentação correspondente fora do sistema e define o responsável por autorizar o uso; o checkbox não substitui essa documentação. Na apresentação, utilize cadastros e imagens fictícios.
- Acesso: a única conta de tutora/ADM desta instalação pode consultar e gerenciar todos os alunos. Ainda não existe separação entre várias instituições ou tutoras.
- Retenção: cadastros ativos e inativos permanecem até exclusão explícita. A limpeza de 48 horas é exclusiva dos chamados atendidos, sem apagar alunos ou fotos.
- Retirada da autorização: exclua o cadastro para remover os dados e a foto do banco ativo. Desativar, por si só, não retira esses dados. A exclusão também remove o nome e a referência do aluno dos vínculos, mantendo a identificação do aparelho sem aluno. A exclusão também remove identificação e nome do aluno dos chamados, preservando mensagem, situação e datas; chamados pendentes não são apagados.
- Não há backup automático. Uma cópia manual de `data/` contém fotos e dados pessoais; deve ficar restrita à equipe responsável. A exclusão do banco ativo não altera cópias externas. Essas cópias devem ser revisadas ao atender uma exclusão, e dados excluídos não devem ser reintroduzidos ao restaurar uma cópia. A política de backups para implantação ainda precisa ser definida com a instituição.

## Vínculos dos comunicadores

Na aba **Comunicadores**, informe a identificação exata usada no argumento `--dispositivo` do aparelho (por exemplo, `Comunicador 01`; o padrão sem esse argumento é `MVP`). Selecione um aluno ativo e clique em **Salvar vínculo**. A lista reúne aparelhos cadastrados manualmente e os que já enviaram pedidos ao servidor. A identificação diferencia maiúsculas e minúsculas.

Use **Alterar vínculo** para trocar o aluno. Escolha **Sem aluno vinculado** para remover a associação; trocas e remoções pedem confirmação. Cada aparelho tem um aluno por vez, e um aluno pode utilizar vários aparelhos. O vínculo permanece após reiniciar o servidor. Edições feitas em outra sessão são detectadas para evitar sobrescrever alterações sem revisão.

Desativar o aluno mantém o vínculo existente com a indicação de inativo; não é possível criar um vínculo novo com esse aluno. Excluir o aluno remove sua referência dos aparelhos. Apenas a conta autenticada pode consultar ou alterar vínculos; a credencial de envio do comunicador não permite essas operações.

O vínculo pode ser configurado no portal e o servidor já registra `aluno_id` e `aluno_nome` nos chamados novos, usando exclusivamente o aluno ativo vinculado à identificação do aparelho. O comunicador continua enviando sua identificação normalmente; não precisa consultar cadastros ou carregar dados pessoais. Identificações de aluno informadas pelo remetente não substituem o vínculo configurado no servidor.

A associação é definida quando o servidor recebe o pedido, inclusive no envio de mensagens que ficaram na fila sem conexão. Aparelhos sem vínculo e alunos inativos não bloqueiam pedidos: nesses casos os campos do aluno ficam vazios. Pedidos anteriores à configuração não são associados retroativamente. O reenvio do mesmo pedido mantém o primeiro registro. Alterar o vínculo vale para os próximos pedidos, sem reatribuir registros já recebidos.

Os pedidos pendentes e o histórico exibem o nome registrado no recebimento, a foto atual do cadastro e a identificação do comunicador. Sem foto, aparecem as iniciais. Se a imagem não puder ser carregada, as iniciais continuam visíveis. Pedidos sem aluno mostram **Aluno não identificado**. A foto continua protegida pelo login e não há cópias históricas das imagens.

O filtro **Aluno** funciona nos pendentes e no histórico e pode ser combinado com comunicador, situação e busca por mensagem, nome exibido do aluno ou comunicador. Há opções **Todos os alunos** e **Sem aluno identificado**. A filtragem usa a identificação interna, mantendo separados cadastros de mesmo nome. Os cadastros ativos/inativos e os alunos presentes nos chamados alimentam as opções. Atualizações e mudanças entre pendentes e histórico preservam a seleção; sair do portal limpa as opções pessoais e os filtros.

A identificação histórica usa a identificação interna e o nome salvos no recebimento, sem recalcular o aluno pelo vínculo atual do aparelho. Renomear, desativar ou reativar um aluno, trocar/remover o vínculo, reenviar o mesmo pedido e reiniciar o servidor não alteram esses campos dos chamados já recebidos. Um pedido novo passa a usar o nome e vínculo válidos no seu recebimento; um pedido antigo sem aluno não recebe associação retroativa.

As fotos continuam sendo as atuais do cadastro daquele aluno, sem manter cópias antigas. A exclusão definitiva é a exceção deliberada: remove identificação e nome desse aluno dos chamados e apaga sua foto, preservando solicitações, situações e datas. Isso não afeta chamados de outros alunos. Pendentes permanecem até o atendimento; os atendidos saem 48 horas depois do atendimento, mesmo que o cadastro tenha sido renomeado ou desativado.

## Portal do aluno — entrada por foto e nome

Fluxo revisado em 12/11/2026: a tutora cadastra e mantém os alunos no portal dela. Os alunos ativos aparecem automaticamente em blocos no `/aluno`. O estudante não digita identificação do comunicador, usuário nem senha e não precisa de vínculo individual com um aparelho.

### Preparar o navegador uma vez

1. A tutora cadastra os alunos com nome, foto opcional e perfil de acessibilidade na aba **Alunos**. Não é necessário criar um comunicador físico para usar a seleção web.
2. No navegador compartilhado, a tutora entra em `http://IP_DO_SERVIDOR:8765/` e clica em **Portal do aluno**, no canto superior direito. No próprio servidor, pode usar `http://localhost:8765/`.
3. O portal libera automaticamente esse navegador para consultar a grade e encerra a sessão administrativa nele. Outros navegadores da tutora continuam autenticados.
4. Depois disso, `/aluno` abre diretamente os blocos. O aluno toca na própria foto ou nome e entra nas categorias. **Trocar aluno** volta à grade, sem alterar os vínculos dos aparelhos ou a escolha em outro navegador.

A liberação dura oito horas e usa um cookie `HttpOnly`, `SameSite=Strict`. Um visitante sem essa liberação não consegue consultar nomes, perfis ou fotos: verá somente o pedido de entrada da tutora. Após expirar ou limpar os cookies, a tutora libera novamente. Escolher o bloco identifica o usuário da comunicação; isso **não é uma autenticação pessoal do aluno**.

### Blocos e cores

A entrada contém os blocos de alunos ativos, sem formulário. Cada bloco exibe a foto, o nome e uma tag pequena com texto e cor. Sem foto, usa iniciais. Os nomes vêm do cadastro da tutora e a seleção distingue alunos de mesmo nome pela identificação interna.

| Perfil cadastrado | Cor do projeto |
| --- | --- |
| TEA | Azul |
| Acessibilidade motora | Roxo |
| Baixa visão | Âmbar |
| Acessibilidade cognitiva | Verde |
| Padrão | Cinza |

As cores foram aprovadas como convenção visual deste projeto, **não representam uma padronização oficial**. As tags usam o perfil existente no cadastro; não acrescentam diagnóstico nem interpretam `Padrão` como ausência de deficiência. A informação permanece legível pelo texto, sem depender somente da cor.

A grade adapta as colunas para celular, tablet e PC e consulta mudanças a cada 15 segundos enquanto a página está visível. Desativação e exclusão retiram o aluno da grade e interrompem a consulta de seu retrato. Renomear ou trocar a foto atualiza o bloco. Recarregar `/aluno` volta à seleção, e a entrada de comunicação mantém nome/foto do aluno escolhido. Em falhas de conexão, os avisos oferecem atualização; a comunicação não continua exibindo uma identidade como confirmada após uma consulta que falhou.

### Arquivos e proteção dos dados

`aluno.html`, `aluno.css` e `aluno.js` implementam a grade, a seleção e as categorias. `modo_aluno.py` consulta o cadastro e guarda a escolha na sessão de cada navegador, sem modificar a associação global do comunicador. A migração acrescenta campos à tabela `sessoes_comunicador` e cria `sessoes_entrada`, preservando os registros existentes.

- `POST /api/aluno/liberar`: exige a tutora autenticada e `X-Portal: aluno`; cria a liberação da grade e encerra sua sessão administrativa naquele navegador.
- `GET /api/aluno/entrada` e `GET /api/aluno/retrato/{token}`: exigem a liberação válida, retornando somente alunos ativos e os dados necessários aos blocos.
- `POST /api/aluno/selecionar`: exige a liberação, valida o aluno ativo e cria uma sessão restrita à escolha daquele navegador.
- `GET /api/aluno/perfil`, `/api/aluno/foto` e `/api/aluno/catalogo`: exigem a sessão do modo aluno. As APIs administrativas permanecem exclusivas da tutora.
- `POST /api/aluno/desconectar`: apaga a escolha atual; preserva a liberação da grade para a troca de aluno.

O antigo endpoint técnico `/api/aluno/configurar` continua compatível com sessões vinculadas a aparelhos, mas o formulário correspondente não aparece na entrada do aluno. O protótipo físico e seus vínculos continuam funcionando separadamente.

A exposição dos blocos, incluindo fotos e perfis, fica limitada ao navegador liberado pela instituição. HTTP e a conta de testes continuam restritos ao ensaio com dados fictícios em rede de confiança. A liberação de um navegador compartilhado autoriza a visualização da grade, sem dar acesso a edição, histórico ou atendimento.

Os testes `test_entrada_alunos.py` cobrem proteção, cores, filtragem de inativos e escolhas independentes. `test_portal_modo_aluno.cjs` ensaia a grade e a comunicação no navegador, inclusive teclado, expiração e larguras de celular, tablet e PC. Os aparelhos reais ainda precisam de validação.

## Modo aluno — etapa 2: tela e navegação de comunicação

Implementado em 12/11/2026, em `/aluno`, sobre a identificação já configurada. O layout é uma primeira versão para revisão de design: funciona em celular, tablet e PC e prioriza botões amplos no tablet.

- O cabeçalho da área de comunicação mantém nome, foto ou iniciais e identificação do aparelho.
- A tela inicial mostra **Necessidades**, **Sentimentos**, **Conversar** e acesso direto a **Ajuda**.
- **Necessidades:** Água, Comida, Banheiro e Descanso.
- **Sentimentos:** Não estou bem, Feliz, Triste, Dor e Medo.
- **Conversar:** Sim, Não, Obrigado e De novo.
- Cada opção apresenta texto e pictograma local. A grade se adapta à largura disponível, sem limitar o tablet a quatro mensagens por página.
- Ao tocar numa mensagem, o botão fica selecionado e a frase aparece em **Mensagem selecionada**. Selecionar outra opção substitui a seleção. **Início** retorna às categorias e limpa a frase escolhida.
- Atualizar o nome ou a foto do mesmo aluno preserva a categoria, a seleção e o foco do teclado. Trocar o aluno, perder o vínculo, expirar a sessão ou falhar uma consulta limpa a seleção anterior.

**Selecionar ainda não fala nem envia um pedido.** Esta etapa implementa apresentação e navegação; a confirmação, síntese de voz e envio serão acrescentados separadamente. Os perfis continuam carregados, mas ainda não modificam o layout. O cadastro da tutora não ganhou opções de personalização de mensagens nesta etapa.

O catálogo vem de `mensagens.catalogo_aluno()` por `GET /api/aluno/catalogo`, protegido pela sessão do aluno. As seis frases principais reutilizam `MENSAGENS`; as opções adicionais mantêm os textos do protótipo. O catálogo não contém cadastros nem dados pessoais. A interface continua em `aluno.html`, `aluno.css` e `aluno.js`.

Os testes do modo aluno verificam o catálogo, as 14 mensagens (incluindo Ajuda), textos e pictogramas, navegação por toque/teclado, seleção única, preservação de foco, limpeza após troca de aluno e ausência de envio de chamados. O ensaio no Edge cobre larguras de celular, tablet e PC; não substitui a validação nos aparelhos reais.

## Exclusão em 48 horas

Cada pedido atendido é excluído 48 horas após o atendimento, registrado no campo `atualizado`. Pedidos novos e recebidos permanecem até serem atendidos, independentemente da idade. Repetir a confirmação ou o atendimento não reinicia a contagem. A limpeza ocorre ao iniciar o servidor, consultar ou alterar pedidos e a cada minuto enquanto estiver ligado. Com o servidor desligado, ocorre na próxima inicialização. Não é uma limpeza geral em horário fixo e não apaga a conta de acesso.

## Acesso pelo celular ou outro computador

Mantenha os aparelhos na mesma rede Wi-Fi. O terminal mostra possíveis endereços, como `http://192.168.1.10:8765`. Abra o endereço da rede do servidor e use a mesma instituição, usuário e senha. Não use `127.0.0.1` no celular para acessar o computador.

Uma nova cópia do projeto em outro PC tem um banco novo porque `data/` não vai para o GitHub. Execute `python servidor.py --demo` para criar o mesmo perfil de testes nessa nova instalação. Não precisa rodar um servidor em cada PC para acessar o portal existente.

Este MVP usa HTTP na rede local: senhas, cookies e dados trafegam sem criptografia. Use apenas dados fictícios na demonstração e uma rede de confiança. Não exponha a porta no roteador. Ele não inclui acesso público pela internet, APK nem notificações em segundo plano.

## Comunicadores

Escolha um único servidor para reunir todos os pedidos. A credencial de envio aparece no terminal como **Credencial dos comunicadores** e permanece em `data/acesso.txt`. Ela é separada do login e só permite enviar pedidos, sem consultar dados ou atender solicitações. A credencial é compartilhada: quem a possui consegue enviar com qualquer identificação de aparelho. O vínculo identifica o aluno pelo nome do aparelho, sem autenticação individual do hardware. Para uso real, faltam credenciais individuais por comunicador e HTTPS.

No Raspberry que também hospeda o servidor:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 01"
```

Nos outros:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 02" --servidor http://IP_DO_SERVIDOR:8765 --codigo CREDENCIAL_DO_COMUNICADOR
```

Use uma identificação diferente por aparelho, com até 80 caracteres. O Raspberry depende de Tkinter e `espeak-ng`/`espeak`; o servidor usa Pillow para validar e normalizar fotos (`python -m pip install -r requirements.txt`). O driver da tela física é configurado separadamente.

O comunicador inclui **Sentimentos → Não estou bem**, com a confirmação **Falar e enviar**. Essa categoria tem duas páginas de até quatro opções, acessíveis por **Mais ›** e **‹ Anterior**. As mensagens Feliz, Triste, Dor e Medo continuam disponíveis. O botão Voltar da confirmação retorna à página em que a mensagem foi escolhida.

No protótipo, cada tela de confirmação gera uma identificação única. **Falar e enviar** fica desabilitado enquanto o pedido é guardado, e a mesma confirmação não pode ser consumida duas vezes. Se uma tentativa falhar depois de gravar, o retry usa a mesma identificação na fila. Cancelar invalida a confirmação anterior. Para pedir a mesma coisa novamente, o aluno pode fazer uma nova seleção e confirmação. O futuro portal web para tablet deverá seguir a mesma regra.

As seis mensagens principais estão centralizadas em `mensagens.py`, com os mesmos textos na confirmação, fala, envio e demonstração:

| Opção | Mensagem |
| --- | --- |
| Água | Quero água. |
| Banheiro | Quero ir ao banheiro. |
| Ajuda | Preciso de ajuda. |
| Não estou bem | Não estou bem. |
| Comida | Estou com fome. |
| Descanso | Quero descansar. |

As opções adicionais continuam disponíveis no protótipo. O portal do aluno no tablet poderá mostrar mais opções por tela, conforme a área disponível e as preferências de acessibilidade. A revisão dos textos não altera os chamados já registrados. A compreensão das mensagens e dos desenhos ainda será avaliada com a equipe.

## Arquivos principais

- `servidor.py`: API, pedidos, retenção e sessões HTTP.
- `alunos.py`: cadastros, fotos, autorização, edição e desativação/exclusão.
- `comunicadores.py`: configuração persistente dos vínculos entre alunos e aparelhos.
- `requirements.txt`: dependência Pillow usada no servidor.
- `acesso.py`: senha derivada, autenticação, sessão e bloqueio de tentativas.
- `configurar_acesso.py`: configuração e redefinição local da conta.
- `tutora.html`, `portal.css` e `portal.js`: telas e funcionamento do portal.
- `comunicador.py` e `transporte.py`: protótipo da interface do aluno e fila de envio.
- `mensagens.py`: catálogo compartilhado e reconhecimento de textos atuais e anteriores.
- `pictogramas.svg`: desenhos vetoriais locais das solicitações.
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

O cadastro foi ensaiado no Edge em larguras de computador e celular com banco temporário e dados fictícios. Ainda faltam celular real, áudio, leitor de tela, Raspberry físico e ensaio na rede da apresentação. A aplicação dos perfis às interfaces do aluno continua sendo uma próxima etapa. A identificação histórica foi verificada após renomear, trocar o aluno do aparelho, excluir o cadastro, recarregar o portal e reiniciar o servidor.
O ensaio de interface em `tests/test_portal_alunos.cjs` usa Playwright e inicia um servidor com banco temporário próprio, sem alterar os cadastros da instalação. Para executá-lo, disponibilize o pacote Playwright e seu Chromium e use `node tests/test_portal_alunos.cjs`. Opcionalmente, `PYTHON_TEST` seleciona o executável Python e `TEST_BROWSER=msedge` usa o Edge instalado. As capturas ficam em `tmp/`, fora do Git.
