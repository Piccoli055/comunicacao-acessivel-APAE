// Ensaio do modo aluno em banco temporário; não altera a instalação real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {spawn,spawnSync} = require('node:child_process');
const {chromium,request} = require('playwright');
const raiz=path.join(__dirname,'..'), python=process.env.PYTHON_TEST || 'python';
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'baixa-visao-'));
let servidor,navegador,admin;
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
async function esperarCondicao(page,condicao){
  const limite=Date.now()+20000;
  while(Date.now()<limite){if(await page.evaluate(condicao))return;await pausa(100);}
  throw new Error('Condição assíncrona da fila não foi satisfeita.');
}
async function capturar(page,opcoes){
  for(let tentativa=0;;tentativa++){
    try{return await page.screenshot(opcoes);}
    catch(erro){if(tentativa>=2 || !erro.message.includes('Unable to capture screenshot'))throw erro;await pausa(250);}
  }
}
(async()=>{
  const porta=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url='http://127.0.0.1:'+porta;
  servidor=spawn(python,['-B','servidor.py','--demo','--porta',String(porta),'--dados',path.join(temporario,'dados')],{cwd:raiz,stdio:'ignore',windowsHide:true});
  let pronto=false;
  for(let i=0;i<80;i++){pronto=await new Promise(resolve=>{const req=http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode===200));});req.on('error',()=>resolve(false));req.setTimeout(1500,()=>{req.destroy();resolve(false);});});if(pronto)break;await pausa(200);}
  assert(pronto,'Servidor não iniciou');
  admin=await request.newContext({baseURL:url,extraHTTPHeaders:{'X-Portal':'tutora'}});
  async function post(rota,dados){const r=await admin.post(rota,{data:dados});assert(r.ok(),await r.text());return r.json();}
  await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});
  const fixture=path.join(temporario,'foto.png');
  const foto=spawnSync(python,['-c',"from PIL import Image; import sys; Image.new('RGB',(100,100),'teal').save(sys.argv[1])",fixture],{windowsHide:true});
  assert.equal(foto.status,0);
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'baixa_visao',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
  const bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
  await post('/api/comunicadores/vincular',{dispositivo:'Tablet 01',aluno_id:ana.id,versao:0});
  navegador=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
  const contexto=await navegador.newContext({viewport:{width:1024,height:768}});
  await contexto.addInitScript(() => {
    window.ensaioVoz={falas:[],cancelamentos:0};
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
      getVoices:()=>[{lang:'pt-BR',localService:true,name:'Voz fictícia'}],
      cancel:()=>window.ensaioVoz.cancelamentos++,
      speak:fala=>{window.ensaioVoz.falas.push({texto:fala.text,lang:fala.lang});window.ultimaFala=fala;},
    }});
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  });
  let page=await contexto.newPage();page.setDefaultTimeout(20000);
  const erros=[];
  function observar(p){p.on('pageerror',e=>erros.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/i.test(m.text()))erros.push(m.text());});}
  observar(page);

  await contexto.addCookies((await admin.storageState()).cookies);
  await page.goto(url);
  await page.locator('#portal').waitFor({state:'visible'});await page.locator('#abrir-modo-aluno').click();
  await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  await page.locator('[data-aluno="'+ana.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  // A liberação revogou a sessão administrativa copiada; cria uma separada para as consultas do ensaio.
  await post('/api/login',{instituicao:'164275',usuario:'testedev',senha:'123456'});
  assert(await page.locator('body').evaluate(b=>b.classList.contains('baixa-visao')));
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),1);
  assert.equal(await page.locator('#posicao-opcao').innerText(),'Categoria 1 de 3');
  await page.locator('[data-categoria="necessidades"]').click();
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),1);
  assert.equal(await page.locator('#posicao-opcao').innerText(),'Mensagem 1 de 4');
  await page.locator('#opcao-proxima').click();
  assert.equal(await page.locator('#opcoes-comunicacao [data-mensagem]').getAttribute('data-mensagem'),'comida');
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).at(-1).texto,'Estou com fome.');
  await page.locator('[data-mensagem="comida"]').click();
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Estou com fome.');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  assert(await page.locator('#ajuda-confirmacao').isVisible());
  assert.equal(await page.locator('#voltar-mensagem').isVisible(),false);
  await page.locator('#voltar-confirmacao-baixa-visao').click();
  assert(await page.locator('[data-mensagem="comida"]').evaluate(b=>b===document.activeElement));
  await page.evaluate(()=>atualizar());
  assert.equal(await page.locator('#posicao-opcao').innerText(),'Mensagem 2 de 4');
  await page.locator('#opcao-anterior').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#opcoes-comunicacao [data-mensagem]').getAttribute('data-mensagem'),'agua');
  await page.locator('#ajuda-baixa-visao').click();
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Preciso de ajuda.');
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).at(-1).texto,'Preciso de ajuda.');
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['retrato',768,1024],['celular',390,844],['zoom',320,600],['pc',1366,900]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await page.locator('#selecao-mensagem').evaluate(d=>d.scrollWidth<=d.clientWidth));
    const cores=await page.locator('#confirmar-mensagem').evaluate(b=>({cor:getComputedStyle(b).color,fundo:getComputedStyle(b).backgroundColor,altura:b.getBoundingClientRect().height}));
    assert.equal(cores.cor,'rgb(255, 255, 255)');assert.equal(cores.fundo,'rgb(32, 42, 52)');assert(cores.altura>=76);
    await capturar(page,{path:path.join(raiz,'tmp','baixa-visao-confirmacao-'+nome+'.png'),fullPage:true});
  }
  await page.keyboard.press('Escape');
  assert(await page.locator('#ajuda-baixa-visao').evaluate(b=>b===document.activeElement));
  await page.setViewportSize({width:1024,height:768});
  await page.locator('#ajuda-baixa-visao').click();await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const lista=await FilaAluno.listar();return lista.length===0 && !enviando;});
  const pedidos=await (await admin.get('/api/pedidos')).json();assert.equal(pedidos.length,1);assert.equal(pedidos[0].prioridade,'ajuda');
  // A barra permanece na mesma posição com a página rolada.
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  assert(await page.locator('#apoio-baixa-visao').evaluate(n=>Math.abs(n.getBoundingClientRect().top)<2));
  await capturar(page,{path:path.join(raiz,'tmp','baixa-visao-tablet.png'),fullPage:true});
  // Falta de API/erro de voz não bloqueia confirmação e não envia sozinho.
  await page.evaluate(()=>Object.defineProperty(window,'speechSynthesis',{configurable:true,value:null}));
  await page.locator('#ajuda-baixa-visao').click();assert(await page.locator('#aviso-voz-confirmacao').isVisible());
  assert(await page.locator('#confirmar-mensagem').isEnabled());await page.keyboard.press('Escape');
  await page.locator('#trocar-aluno').click();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('baixa-visao')),false);
  await page.locator('[data-aluno="'+bruno.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),4);assert(await page.locator('#apoio-baixa-visao').isHidden());
  await page.locator('[data-mensagem="ajuda"]').click();assert(await page.locator('#aviso-voz-confirmacao').isHidden());await page.keyboard.press('Escape');
  // Mudança do perfil pela tutora é aplicada sem recarregar e limpa a navegação anterior.
  await post('/api/alunos/editar',{id:bruno.id,versao:1,nome:bruno.nome,perfil_acessibilidade:'baixa_visao',autorizado:true});
  await page.evaluate(()=>atualizar());assert(await page.locator('body').evaluate(b=>b.classList.contains('baixa-visao')));
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),1);
  assert.deepEqual(erros,[]);
  console.log('OK técnico: perfil automático, uma opção por vez, navegação, contraste/layouts, voz simulada e indisponível, cancelamento, ajuda, envio explícito, troca e atualização de perfil. Validação de Eduardo e áudio real pendentes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('baixa-visao-'))fs.rmSync(alvo,{recursive:true,force:true});
});
