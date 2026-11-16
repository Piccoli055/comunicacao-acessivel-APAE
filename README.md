# Comunicador acessível MVP

Projeto local com servidor no Raspberry Pi 3 B+ ou computador e portal da tutora no navegador. O portal do aluno abre uma grade de alunos ativos, com foto, nome e tag colorida; tocar no próprio bloco abre a comunicação. Os dois portais atendem celular, tablet e PC; o da tutora prioriza celular e PC, e o do aluno prioriza tablet. A tela do aluno apresenta categorias, pictogramas, confirmação e envio de texto, com fila persistente para interrupções de conexão. Os perfis de baixa visão, motor, cognitivo e TEA têm padrões próprios de apresentação e interação; sua validação de uso continua pendente. A interface Tkinter de 480 × 320 é um protótipo de demonstração existente; essa dimensão não limita o futuro portal do aluno. O uso nos aparelhos e com pessoas da APAE ainda precisa de validação.

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

## Cadastro e acesso de tutores

Na conta administrativa (`164275 / testedev / 123456` no modo de testes), abra a aba **Tutores** e clique em **Cadastrar tutor**. Informe nome, usuário, senha e os alunos sob responsabilidade. O CNPJ/código da conta administrativa é vinculado automaticamente ao acesso, sem criar outra instituição.

Exemplo de uso:

1. Cadastre o aluno na aba **Alunos**.
2. Em **Tutores**, crie **Liliane**, usuário `liliane`, senha `123`, e marque os alunos dela.
3. Saia do portal e entre com instituição `164275`, usuário `liliane` e senha `123`.
4. O nome Liliane aparece no perfil. **Pedidos pendentes** mostra os chamados dos alunos atribuídos a ela e os chamados sem responsável que forem sorteados para ela. **Histórico** permite consultar os chamados de todos os tutores, inclusive os ainda pendentes, sem ações de atendimento nessa aba.

A senha de três caracteres é permitida somente para tutores da instituição de testes `164275`. Para uma instituição com CNPJ, a senha deve ter pelo menos dez caracteres. O máximo é 128. Usuários são únicos por instituição e não diferenciam maiúsculas/minúsculas; o usuário administrativo não pode ser reutilizado. Senhas ficam derivadas com sal e PBKDF2 e nunca são retornadas pelas APIs ou preenchidas ao editar.

### Responsáveis e permissões

- Nesta versão, cada aluno tem **um tutor responsável por vez**, e um tutor pode acompanhar vários alunos. A seleção fica no formulário do tutor. Alunos de mesmo nome continuam separados pela identificação interna.
- A conta administrativa gerencia os tutores e vê todos os pendentes, inclusive chamados sem aluno ou sem tutor atribuído. Um tutor comum não pode criar/editar contas de outros tutores.
- Sem tutor vinculado, cada chamado é sorteado uma vez entre os tutores cadastrados e ativos da instituição. O destinatário fica salvo e não muda ao consultar, atualizar ou reenviar a mesma solicitação. Ativo refere-se ao cadastro, não a estar conectado no momento.
- Com tutor vinculado e ativo, o chamado vai exclusivamente a ele e recebe a tag **Responsável**, também preservada no histórico. Chamados sorteados não recebem essa tag. Se o responsável estiver inativo, não há desvio automático para outro tutor: o administrador acompanha até a reativação ou troca do vínculo.
- Sem nenhum tutor ativo, o chamado fica pendente sob acompanhamento administrativo. Ao cadastrar/reativar um tutor, os chamados sem vínculo que estavam sem destinatário são distribuídos.
- O tutor pode confirmar e atender somente seus chamados. Essa regra também é verificada no servidor; alterar a requisição ou consultar o histórico não permite atender chamados de outra pessoa.
- O histórico é compartilhado por definição e mostra o nome do responsável registrado. A API de pedidos entrega os registros necessários ao histórico compartilhado e informa `meu_pedido` para a visualização de pendentes; o histórico comum não representa isolamento de leitura entre tutores.
- A troca de responsável exige confirmação quando um aluno já pertence a outro tutor. Os **pendentes** mudam para o novo responsável. Os **atendidos** preservam o responsável e o horário de atendimento anteriores, sem renovar as 48 horas de retenção.
- Desativar o tutor bloqueia o login. Pendentes recebidos por sorteio são encaminhados a outro tutor ativo, se houver; pedidos dos alunos vinculados continuam sob acompanhamento administrativo até reativação ou transferência. Os chamados atendidos permanecem intactos. Não há exclusão definitiva de tutores nesta etapa.
- Edições do tutor revogam suas sessões; deixar a senha vazia na edição preserva a senha atual. Redefinir a conta administrativa também revoga as sessões dos tutores. Reiniciar o servidor preserva os cadastros e os vínculos.

O recebimento de pedidos continua usando a identificação do aluno resolvida no servidor. Chamados de comunicadores físicos precisam do vínculo de aparelho para identificar o aluno; pedidos anteriores à configuração desse vínculo permanecem sem aluno. O portal web do aluno permite escolher, confirmar e enviar mensagens de texto, com fila persistente no navegador. Fala e sons serão tratados nos modos de acessibilidade.

Esta instalação continua atendendo uma instituição por servidor/banco; não foi criada uma plataforma com várias instituições no mesmo banco. Os endpoints administrativos de cadastro são `/api/tutores` e `/api/tutores/editar`; `tutores.py` guarda vínculos e responsáveis, e `tutores.js` implementa a interface. `tests/test_tutores.py` e `tests/test_portal_tutores.cjs` verificam login individual, autorização, cadastro, transferências e histórico compartilhado.

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


## Modo aluno — confirmação da mensagem

- [x] Abrir uma confirmação com pictograma e frase completa ao escolher qualquer mensagem, inclusive Ajuda.
- [x] Oferecer Voltar, preservando a categoria e devolvendo o foco ao botão escolhido; Escape também volta.
- [x] Manter o foco dentro da confirmação e preservar a escolha em atualizações do mesmo aluno.
- [x] Limpar a confirmação ao trocar de aluno, perder o acesso ou detectar cadastro inativo/falha de conexão.
- [ ] Ativar Falar e enviar com fala e envio autenticado pelo aluno selecionado.

Na primeira entrega da confirmação, Falar e enviar ficou desabilitado. As etapas seguintes abaixo substituíram esse botão por Enviar mensagem e acrescentaram envio de texto e fila persistente. A confirmação usa diálogo nativo e layout para celular, tablet e PC.


## Modo aluno — envio de texto pela confirmação

- [x] Ativar Enviar mensagem na confirmação, sem fala, gravação ou reprodução de áudio.
- [x] Exigir sessão do aluno e resolver identidade, frase e prioridade no servidor; recusar aluno inativo ou identificação alterada.
- [x] Usar o encaminhamento existente: responsável ativo ou sorteio entre tutores ativos, com as exceções documentadas.
- [x] Bloquear toques repetidos e preservar o identificador ao tentar novamente após falha de rede, sem duplicar ou sortear novamente.
- [x] Mostrar sucesso somente após confirmação do servidor; em falha, permitir nova tentativa no diálogo.
- [ ] Implementar retorno sonoro na etapa de modos de acessibilidade.
- [x] Implementar fila offline persistente no navegador.

O botão Enviar mensagem salva a confirmação na fila persistente antes do envio. A mensagem chega à tutora sem reprodução de voz. O funcionamento e os limites da fila estão descritos abaixo.


## Fila offline do portal do aluno

Depois de abrir o portal e selecionar um aluno com conexão, é possível confirmar mensagens durante uma interrupção da rede. **Mensagem guardada. Aguardando envio à tutora** significa que a tutora ainda não confirmou o recebimento; somente a resposta do servidor permite mostrar **Mensagem enviada à tutora**.

- Cada confirmação é gravada no IndexedDB antes do POST. A fila contém somente ID aleatório da confirmação, ID interno do aluno, código da opção e horário local; erros definitivos acrescentam um indicador de bloqueio. Não grava fotos, nomes, senhas ou cookies.
- Com a página visível, tenta enviar a cada cinco segundos, aumentando o intervalo de falhas até trinta segundos. Voltar à página ou recuperar a rede também permite retomar. O botão Tentar enviar agora antecipa a tentativa. Navegador fechado ou suspenso não envia em segundo plano.
- O mesmo aluno precisa estar selecionado. Trocar de aluno preserva os pendentes anteriores, sem atribuí-los ao novo aluno. Depois de recarregar ou reabrir a página, escolha novamente o aluno que criou os pedidos; se o acesso expirou, a tutora precisa liberar o navegador.
- O servidor exige sessão válida e aluno ativo em cada envio. Erros de autenticação suspendem o envio; solicitações recusadas por dados inválidos/identificação alterada ficam guardadas e sinalizadas para revisão, sem tentativa automática daquele registro.
- O ID é preservado após resposta perdida, troca de sessão e reinício. Um recibo técnico com dois valores derivados (`id` e `assinatura`) permanece no servidor, sem armazenar nome, frase ou foto, para não recriar o chamado mesmo após a limpeza do histórico. Esses recibos não são apagados pela retenção de 48h; a remoção do conteúdo do histórico continua igual.
- Limpar fila deste navegador exige confirmação e descarta todos os pendentes locais, de todos os alunos. Não apaga pedidos já recebidos no servidor. Pedidos bloqueados ou de alunos excluídos também podem ser descartados assim. Ao excluir um aluno, revise as filas dos aparelhos que ele utilizou; o servidor não tem acesso ao armazenamento local dos navegadores.
- Falha ou falta de espaço no armazenamento impede a confirmação: o portal informa que nada foi enviado e mantém a mensagem aberta. Limpar dados do navegador também apaga a fila. A fila depende do mesmo navegador e endereço do servidor (protocolo, IP/nome e porta); outro endereço tem armazenamento separado.

Esta função **não disponibiliza o portal inteiro para abrir sem rede**: o primeiro carregamento e a escolha do aluno exigem o servidor. Com a página já aberta, a tela do aluno é preservada durante falha de conexão, com aviso de que os pedidos aguardam envio. O servidor revalida o cadastro ao reconectar. O encaminhamento usa os vínculos e tutores ativos no momento do primeiro recebimento no servidor; o horário do chamado é o do recebimento, e o horário local só organiza a fila. Não há áudio nesta etapa.


## Perfil fixo de baixa visão — implementação

Aplicado automaticamente quando o cadastro do aluno usa `baixa_visao`, sem controles de personalização no MVP. Os demais perfis mantêm a grade padrão.

- [x] Implementado: fundo escuro, texto claro, contornos fortes, textos/pictogramas ampliados e botões com altura mínima de 76 px CSS.
- [x] Implementado: uma categoria ou mensagem por vez, contador de posição e Anterior/Próxima; sem avanço automático.
- [x] Implementado: barra superior com Voltar e Ajuda, preservada durante a rolagem; a confirmação tem sua própria barra equivalente.
- [x] Implementado: leitura da opção por voz no aparelho do aluno ao tocar/ativar, com idioma pt-BR, cancelamento da fala anterior e aviso visual em falha. Ajuda abre confirmação, sem enviar automaticamente.
- [x] Implementado: parar a voz ao voltar, sair, ocultar a página ou trocar de aluno; aplicar alterações do perfil feitas pela tutora na atualização.
- [ ] Validação de Eduardo: aparência, organização e navegação.
- [ ] Validação no tablet real: voz audível em português, orientação, volume e toque.
- [ ] Validação com usuários/equipe: conforto do contraste, leitura e compreensão.

Os testes técnicos do navegador usam voz simulada para conferir as chamadas e o comportamento em falha; não comprovam áudio audível. A fala usa SpeechSynthesis e as vozes disponíveis no aparelho; disponibilidade, português e funcionamento sem rede precisam ser conferidos no tablet. Referência técnica: [MDN — vozes disponíveis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices). Não há gravação de microfone nem áudio enviado à tutora. O envio de texto e a fila offline continuam iguais.

Nesta seção, itens marcados como implementados descrevem código entregue. **A validação de uso fica pendente até Eduardo confirmar**, independentemente de testes automáticos executados.


## Perfil motor fixo — implementação

Aplicado automaticamente ao aluno com perfil `motora`, sem personalização no MVP. O foco é facilitar a precisão do toque: grade com no máximo duas colunas (uma em telas menores), espaços de 32 px CSS e áreas de ação de pelo menos 88 px de altura. A confirmação mantém Voltar acima e Enviar abaixo, separados por 48 px e com altura mínima de 96 px. Mantém o tema claro; não usa voz nem o carrossel de baixa visão.

- [x] Implementado: áreas maiores e espaçamento próprio para seleção, navegação e confirmação.
- [x] Implementado: ativar no click nativo, após soltar; cancelar se o ponteiro sair do botão, mesmo que volte antes da soltura; tratar pointercancel sem bloquear rolagem/zoom.
- [x] Implementado: intervalo fixo de 600 ms entre ativações para evitar repetição inclusive entre telas diferentes. Não é necessário manter pressionado; um toque comum basta.
- [x] Implementado: conservar Tab, Enter, Espaço e Escape, com confirmação explícita; a proteção é removida ao mudar para outro perfil.
- [ ] Validação de Eduardo: disposição, espaçamento e adequação do intervalo.
- [ ] Validação no tablet real: precisão, tremores, cancelamento, rolagem e uso com dispositivos de apoio.
- [ ] Validação com usuários/equipe: adequação do padrão às necessidades de cada aluno.

Os perfis são padrões de interface vinculados ao cadastro, não uma avaliação das capacidades da pessoa. Neste MVP, alunos com o mesmo perfil recebem o mesmo conjunto de adaptações. Não há varredura automática, configuração de acionadores nem ativação ao manter pressionado. O cancelamento segue o princípio de [ativação ao soltar do W3C](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html). Os testes técnicos não substituem a validação de Eduardo, que permanece pendente.


## Perfil cognitivo fixo — implementação

Aplicado automaticamente ao perfil `intelectual` (Acessibilidade cognitiva no cadastro), sem personalização no MVP. A entrada traz Água, Banheiro, Comida, Descanso, Não estou bem e Ajuda diretamente; Mais mensagens abre as oito opções restantes, com Voltar para os seis pedidos principais. Todos os textos de envio continuam vindo do catálogo canônico.

- [x] Implementado: seis pedidos diretos, sem escolher categorias antes.
- [x] Implementado: cartões com pictograma e rótulo curto; frase completa na confirmação.
- [x] Implementado: oito opções adicionais em Mais mensagens, sem retirar mensagens do catálogo.
- [x] Implementado: confirmação Você escolheu, Voltar e Enviar; escolher não envia automaticamente.
- [x] Implementado: estados Aguardando envio e Mensagem enviada com texto e estilos distintos, sem temporizador para desaparecer. Uma nova escolha ou troca de aluno pode limpar o aviso anterior.
- [x] Implementado: sem voz, carrossel ou intervalo entre toques do perfil motor; mantém confirmação, fila e prevenção de duplicação compartilhadas.
- [ ] Validação de Eduardo: organização, rótulos, confirmação e retorno visual.
- [ ] Validação no tablet real: toque, leitura e orientação da tela.
- [ ] Validação com usuários/equipe: compreensão dos pictogramas e adequação dos seis pedidos iniciais.

Os testes técnicos verificam comportamento e apresentação; não comprovam compreensão nem adequação individual. Alunos com este perfil recebem o mesmo padrão nesta versão. Sua validação continua pendente até confirmação explícita de Eduardo.


## Perfil TEA fixo — implementação

Aplicado automaticamente ao perfil `tea`, com foco na previsibilidade da interação. As categorias Necessidades, Sentimentos e Conversar permanecem visíveis, sempre na mesma ordem. A entrada começa em Necessidades; só muda de categoria por escolha do usuário. A confirmação e o resultado mantêm a categoria atual.

- [x] Implementado: navegação persistente por categorias, com texto, pictograma e indicação da categoria selecionada.
- [x] Implementado: grade de duas colunas; Ajuda ocupa sempre a segunda coluna da terceira linha. A célula anterior pode ficar vazia em categorias com quatro mensagens, para preservar a posição de Ajuda. As 14 mensagens continuam disponíveis.
- [x] Implementado: sequência visual Escolher → Confirmar → Resultado, com etapa atual indicada por texto, contorno/estilo e aria-current, também dentro da confirmação.
- [x] Implementado: resultado distingue pedido guardado na fila de mensagem recebida pelo servidor; não avança nem retorna de categoria por temporizador.
- [x] Implementado: sem fala automática, animações, carrossel, restrição de intervalo do perfil motor ou menu direto dos seis essenciais do cognitivo.
- [ ] Validação de Eduardo: previsibilidade, etapas, posição de Ajuda e organização.
- [ ] Validação no tablet real: orientação, toque, zoom e navegação.
- [ ] Validação com usuários/equipe: adequação desse padrão aos alunos que o utilizarão.

TEA não define uma preferência visual ou sensorial única. Este é um padrão fixo proposto para o MVP, aplicado pelo cadastro; não é uma avaliação clínica nem garantia de adequação a todos os alunos. Testes técnicos não substituem a validação de Eduardo e da equipe, que permanece pendente.
