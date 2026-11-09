# Comunicador acessível MVP

Projeto local para Raspberry Pi 3 B+ com tela de 480 × 320 e portal da tutora no navegador do celular. A interface do Raspberry e o uso com pessoas da APAE ainda precisam de validação no aparelho e com os usuários.

## Começar pelo portal no VS Code

Abra o terminal na pasta `comunicador-mvp` e execute:

```powershell
python servidor.py
```

Se o Windows reconhecer apenas o iniciador do Python, use `py servidor.py`.

Abra `http://127.0.0.1:8765` no computador e informe o código que apareceu no terminal. O código é criado na primeira execução e fica em `data/acesso.txt`; ele não é necessariamente o mesmo do primeiro teste feito no chat. Mantenha o terminal do servidor aberto.

Para experimentar vários comunicadores sem o Raspberry:

```powershell
python demonstracao.py
```

Isso cria cinco pedidos fictícios de três comunicadores. O comando só adiciona pedidos quando executado; repeti-lo cria novos pedidos intencionais. Não execute se não quiser misturar exemplos com sua demonstração.

## Fluxo da tutora

1. Um pedido chega como **Novo**. Pedidos de ajuda têm destaque escrito e visual.
2. **Confirmar recebimento** muda o pedido para **Recebido**. Isso significa que a tutora viu a solicitação.
3. **Marcar como atendido** conclui o pedido e o envia para **Histórico**.

Os pendentes aparecem do mais antigo para o mais recente; o histórico de atendidos aparece do mais recente para o mais antigo. Os contadores são de todos os comunicadores; os filtros afetam a lista. Filtre por comunicador, situação ou texto da mensagem.

O botão **Ativar aviso sonoro** precisa ser tocado pela tutora. Ele emite um som de teste e habilita avisos para novos pedidos. O navegador precisa permanecer aberto e o volume do celular deve estar audível. Ao sair ou recarregar a página, é necessário entrar e ativar o som novamente.

O portal se atualiza a cada dois segundos. Se uma ação na lista estiver com foco, a atualização fica aguardando o botão **Atualizar pedidos**, evitando interromper a interação. A conexão é retomada automaticamente após falhas. Uma ação só aparece como concluída depois da confirmação do servidor.

## Exclusão automática após 48 horas

Cada pedido é excluído ao completar 48 horas desde seu **recebimento no servidor**, independentemente de estar novo, recebido ou atendido. Não é uma limpeza geral em horário fixo. A regra foi definida para este MVP.

A limpeza ocorre ao iniciar o servidor, consultar ou alterar pedidos e, sem consultas, a cada minuto enquanto o servidor estiver ligado. Com o servidor desligado, a limpeza é feita na próxima inicialização. Reenvios do mesmo identificador dentro da janela não duplicam o pedido. O relógio do servidor deve estar correto; depois da exclusão, o registro não é recuperável pela aplicação.

## Abrir no celular

O terminal mostra possíveis endereços da rede, por exemplo `http://192.168.1.10:8765`. No celular, abra o endereço da rede Wi-Fi do computador/Raspberry e informe o mesmo código. `localhost` e `127.0.0.1` no celular apontam para o próprio celular, não para o Raspberry.

Os aparelhos precisam estar na mesma rede e a rede deve permitir comunicação entre dispositivos. Se o firewall pedir permissão, permita somente para a rede privada de teste. Não é necessário expor a porta no roteador.

## Vários Raspberry Pi

Escolha **um servidor central** para todos os comunicadores. Não execute um servidor separado por aparelho se quiser acompanhar todos no mesmo portal.

No Raspberry que hospeda o servidor, em outro terminal:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 01"
```

Nos demais aparelhos:

```bash
python3 comunicador.py --tela-cheia --dispositivo "Comunicador 02" --servidor http://IP_DO_SERVIDOR:8765 --codigo CODIGO_DO_SERVIDOR
```

Substitua os valores em maiúsculas. Use um nome diferente, com até 80 caracteres, para cada comunicador. As identificações aparecem no filtro quando os primeiros pedidos chegam; não há cadastro separado de alunos. Use identificações fictícias na apresentação.

A interface do Raspberry depende de Tkinter (`python3-tk`) e o áudio no Linux depende de `espeak-ng` ou `espeak`. O portal e o servidor não precisam de bibliotecas Python externas. A instalação e calibração da tela SPI são etapas separadas.

## Arquivos

- `servidor.py`: API local, armazenamento e exclusão em 48 horas.
- `tutora.html`: estrutura das telas do portal.
- `portal.css`: aparência e adaptação ao celular.
- `portal.js`: filtros, atualização, ações e avisos sonoros.
- `comunicador.py`: interface touch do aluno.
- `transporte.py`: fila persistente e tentativas de envio.
- `demonstracao.py`: envio manual de exemplos fictícios.
- `tests/test_fluxo.py`: testes das regras do servidor e da fila.
- `CHECKLIST_PORTAL.md`: o que está implementado e o que falta validar.

## Problemas comuns

- **Failed to fetch / não foi possível conectar:** abra o endereço do servidor no navegador. Não abra `tutora.html` diretamente nem pelo Live Server do VS Code. Confira se o servidor está rodando.
- **Endereço já em uso:** outro servidor está usando a porta. Encerre a execução anterior no terminal com Ctrl+C ou execute `python servidor.py --porta 8766` e acesse essa porta. Se mudar a porta, ajuste também `--servidor` do comunicador.
- **Página antiga:** confirme que o terminal está na pasta `comunicador-mvp`, reinicie o servidor dessa pasta e atualize o navegador.
- **Código incorreto:** use o código do servidor que está rodando, em `data/acesso.txt`. O código do ambiente isolado de testes não é o do projeto.
- **Sem som:** toque em ativar aviso, confira volume e mantenha a aba aberta. O portal não envia notificações quando fechado.

## Validação

```bash
python -m unittest discover -s tests -v
```

Dez testes cobrem acesso, transições de estado, exclusão em 48 horas, migração do banco anterior, persistência, vários comunicadores e reenvio sem duplicação. Foram feitos testes no navegador com largura de celular, filtros, busca, login inválido, recebimento, atendimento, histórico, saída, interrupção e reconexão ao servidor e preservação do foco.

Ainda são necessários testes no celular real, na rede da apresentação, com áudio audível, leitor de tela e Raspberry físico. Este MVP usa um código compartilhado e HTTP na rede local; não inclui acesso pela internet, contas individuais, APK ou notificações em segundo plano.
