// Ensaio em navegador real. Sempre inicia servidor e banco temporários próprios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const raiz = path.join(__dirname, '..');
const python = process.env.PYTHON_TEST || 'python';
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'cadastro-alunos-'));
let servidor, navegador;
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
async function portaLivre() {
  return new Promise(resolve => {
    const teste = net.createServer();
    teste.listen(0, '127.0.0.1', () => {
      const porta = teste.address().port;
      teste.close(() => resolve(porta));
    });
  });
}
(async () => {
  const porta = await portaLivre();
  const url = 'http://127.0.0.1:' + porta;
  const fixture = path.join(temporario,'foto.png');
  const outra = path.join(temporario,'outra.png');
  const gerador = spawnSync(python, ['-c', "from PIL import Image; import sys; Image.new('RGB',(800,600),'red').save(sys.argv[1]); Image.new('RGB',(640,480),'blue').save(sys.argv[2])",fixture,outra]);
  assert.equal(gerador.status,0,'Falha ao gerar fotos fictícias');
  servidor = spawn(python,['-B','servidor.py','--demo','--porta',String(porta),'--dados',path.join(temporario,'dados')], {cwd:raiz,stdio:'ignore',windowsHide:true});
  let pronto = false;
  for (let i=0;i<80;i++) {
    try { pronto = (await fetch(url)).ok; } catch (_) {}
    if (pronto) break;
    await pausa(200);
  }
  assert(pronto,'Servidor de teste não iniciou');
  navegador = await chromium.launch({headless:true,...(process.env.TEST_BROWSER ? {channel:process.env.TEST_BROWSER} : {})});
  const contexto = await navegador.newContext({viewport:{width:1366,height:900}});
  const page = await contexto.newPage();
  page.setDefaultTimeout(10000);
  const erros = [];
  page.on('pageerror', erro => erros.push(erro.message));
  page.on('console', msg => { if (msg.type()==='error' && /Content Security Policy/i.test(msg.text())) erros.push(msg.text()); });
  await page.goto(url);
  await page.locator('#instituicao').fill('164275');
  await page.locator('#usuario').fill('testedev');
  await page.locator('#senha').fill('123456');
  await page.locator('#conectar').click();
  await page.locator('#portal').waitFor({state:'visible'});
  await page.waitForFunction(() => document.getElementById('total-alunos').textContent === '0');
  await page.locator('#nav-alunos').click();
  await page.locator('#vazio-alunos').waitFor({state:'visible'});
  await page.locator('#novo-aluno').click();
  await page.locator('#aluno-nome').fill('Aluno Fictício');
  await page.locator('#aluno-perfil').selectOption('baixa_visao');
  await page.locator('#salvar-aluno').click();
  assert.equal(await page.locator('#aluno-autorizado').evaluate(no => no.validity.valueMissing),true);
  assert.equal((await (await contexto.request.get(url+'/api/alunos')).json()).length,0);
  await page.locator('#aluno-autorizado').check();
  await page.locator('#aluno-foto').setInputFiles(fixture);
  await page.waitForFunction(() => { const foto=document.getElementById('previa-aluno-foto'); return foto.complete && foto.naturalWidth>0; });
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  await page.screenshot({path:path.join(raiz,'tmp','cadastro-formulario-desktop.png'),fullPage:true});
  await page.locator('#salvar-aluno').click();
  await page.locator('#formulario-aluno').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Aluno Fictício',exact:true}).waitFor();
  let aluno = (await (await contexto.request.get(url+'/api/alunos')).json())[0];
  const primeiraFoto = aluno.foto_url;
  assert(primeiraFoto);
  assert.equal((await contexto.request.get(url+primeiraFoto)).status(),200);
  assert.equal(await page.locator('#total-alunos').textContent(),'1');
  // Persistência após recarregar, com sessão válida.
  await page.reload();
  await page.locator('#portal').waitFor({state:'visible'});
  await page.locator('#nav-alunos').click();
  await page.getByRole('heading',{name:'Aluno Fictício',exact:true}).waitFor();
  await page.getByRole('button',{name:'Editar aluno: Aluno Fictício',exact:true}).click();
  await page.locator('#aluno-nome').fill('Nome Atualizado');
  await page.locator('#aluno-perfil').selectOption('motora');
  await page.locator('#aluno-foto').setInputFiles(outra);
  await page.locator('#salvar-aluno').click();
  await page.locator('#formulario-aluno').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Nome Atualizado',exact:true}).waitFor();
  aluno = (await (await contexto.request.get(url+'/api/alunos')).json())[0];
  assert.notEqual(aluno.foto_url,primeiraFoto);
  assert.equal((await contexto.request.get(url+primeiraFoto)).status(),404);
  // Cancelar a confirmação mantém o cadastro ativo.
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button',{name:'Desativar aluno: Nome Atualizado',exact:true}).click();
  assert.equal((await (await contexto.request.get(url+'/api/alunos')).json())[0].ativo,1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Desativar aluno: Nome Atualizado',exact:true}).click();
  await page.getByRole('button',{name:'Reativar aluno: Nome Atualizado',exact:true}).waitFor();
  assert.equal(await page.locator('#total-alunos').textContent(),'1');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Reativar aluno: Nome Atualizado',exact:true}).click();
  await page.getByRole('button',{name:'Desativar aluno: Nome Atualizado',exact:true}).waitFor();
  // Foto removida explicitamente na edição.
  await page.getByRole('button',{name:'Editar aluno: Nome Atualizado',exact:true}).click();
  await page.locator('#remover-foto-aluno').click();
  await page.locator('#salvar-aluno').click();
  await page.locator('#formulario-aluno').waitFor({state:'hidden'});
  await page.waitForFunction(() => document.querySelectorAll('#lista-alunos img').length===0);
  aluno = (await (await contexto.request.get(url+'/api/alunos')).json())[0];
  assert.equal(aluno.foto_url,null);
  // Layout estreito e recuperação de erro preservam os cadastros carregados.
  await page.setViewportSize({width:360,height:800});
  await page.screenshot({path:path.join(raiz,'tmp','cadastro-listagem-celular.png'),fullPage:true});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth+1),'Rolagem horizontal no celular');
  await page.route('**/api/alunos', rota => rota.abort());
  await page.locator('#atualizar-alunos').click();
  await page.locator('#erro-alunos').waitFor({state:'visible'});
  assert.equal(await page.getByRole('heading',{name:'Nome Atualizado',exact:true}).count(),1);
  await page.unroute('**/api/alunos');
  await page.locator('#atualizar-alunos').click();
  await page.locator('#erro-alunos').waitFor({state:'hidden'});
  // Nome incorreto não exclui; nome correto remove.
  page.once('dialog', dialog => dialog.accept('incorreto'));
  await page.getByRole('button',{name:'Excluir aluno: Nome Atualizado',exact:true}).click();
  assert.equal((await (await contexto.request.get(url+'/api/alunos')).json()).length,1);
  page.once('dialog', dialog => dialog.accept('Nome Atualizado'));
  await page.getByRole('button',{name:'Excluir aluno: Nome Atualizado',exact:true}).click();
  await page.locator('#vazio-alunos').waitFor({state:'visible'});
  assert.equal(await page.locator('#total-alunos').textContent(),'0');
  await page.locator('#novo-aluno').click();
  await page.locator('#aluno-nome').fill('Rascunho');
  await page.locator('#aluno-foto').setInputFiles(fixture);
  await page.screenshot({path:path.join(raiz,'tmp','cadastro-formulario-celular.png'),fullPage:true});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth+1),'Rolagem horizontal no formulário do celular');
  await page.locator('#sair').click();
  await page.locator('#entrada').waitFor({state:'visible'});
  assert.equal(await page.locator('#aluno-nome').inputValue(),'');
  assert.equal(await page.locator('#lista-alunos li').count(),0);
  assert.deepEqual(erros,[]);
  console.log('OK: navegador desktop/celular, autorização, cadastro, fotos, edição, persistência, cancelamento, desativação, reativação, exclusão, erro de rede e logout.');
})().catch(erro => { console.error(erro); process.exitCode=1; }).finally(async () => {
  if (navegador) await navegador.close();
  if (servidor) {
    servidor.kill();
    await new Promise(resolve => { if (servidor.exitCode!==null) resolve(); else servidor.once('exit',resolve); });
  }
  // Somente a pasta temporária criada por este teste, após fechar o servidor.
  assert.equal(path.dirname(path.resolve(temporario)), path.resolve(os.tmpdir()));
  assert(path.basename(temporario).startsWith('cadastro-alunos-'));
  fs.rmSync(temporario,{recursive:true,force:true});
});
