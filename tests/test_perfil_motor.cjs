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
const temporario=fs.mkdtempSync(path.join(os.tmpdir(),'perfil-motor-'));
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
  const ana=await post('/api/alunos',{nome:'Ana fictícia',perfil_acessibilidade:'motora',foto:fs.readFileSync(fixture).toString('base64'),autorizado:true});
  const bruno=await post('/api/alunos',{nome:'Bruno fictício',autorizado:true});
  await post('/api/comunicadores/vincular',{dispositivo:'Tablet 01',aluno_id:ana.id,versao:0});
  navegador=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],...(process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{})});
  const contexto=await navegador.newContext({viewport:{width:1024,height:768},hasTouch:true});
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

  assert(await page.locator('body').evaluate(b=>b.classList.contains('perfil-motor') && !b.classList.contains('baixa-visao')));
  assert.equal(await page.locator('#opcoes-comunicacao button').count(),4);
  assert(await page.locator('#paginacao-baixa-visao').isHidden());
  assert(await page.locator('#orientacao-motora').isVisible());
  async function esperarIntervalo(){await pausa(650);await page.waitForFunction(()=>!enviando && !ocupado);}
  async function centro(seletor){const b=page.locator(seletor);await b.scrollIntoViewIfNeeded();return b.boundingBox();}
  // Mouse: pressionar não seleciona. Sair e voltar durante o mesmo toque cancela.
  await esperarIntervalo();let r=await centro('[data-categoria="necessidades"]');
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'O que você quer comunicar?');
  await page.mouse.move(r.x-8,r.y+r.height/2);await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.up();
  assert.equal(await page.locator('#titulo-comunicacao').innerText(),'O que você quer comunicar?');
  // Cliques repetidos na navegação não escolhem também a mensagem da tela seguinte.
  await page.locator('[data-categoria="necessidades"]').click();
  await page.locator('[data-mensagem="agua"]').click();
  assert(await page.locator('#selecao-mensagem').isHidden());
  await esperarIntervalo();
  // Toque real emulado, com captura implícita: arrastar para fora cancela.
  const cdp=await contexto.newCDPSession(page);
  r=await centro('[data-mensagem="agua"]');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
  assert(await page.locator('#selecao-mensagem').isHidden());
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x-10,y:r.y+r.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(await page.locator('#selecao-mensagem').isHidden());
  // Um toque comum, sem espera/gesto especial, abre a confirmação.
  await esperarIntervalo();r=await centro('[data-mensagem="agua"]');
  await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
  assert(await page.locator('#selecao-mensagem').isVisible());
  assert.equal(await page.locator('#texto-mensagem').innerText(),'Quero água.');
  // A segunda ativação rápida, mesmo no novo botão, não envia.
  await page.evaluate(()=>document.getElementById('confirmar-mensagem').click());
  assert.equal((await (await admin.get('/api/pedidos')).json()).length,0);
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).length,0);
  fs.mkdirSync(path.join(raiz,'tmp'),{recursive:true});
  for(const [nome,width,height] of [['tablet',1024,768],['celular',390,844],['estreito',320,700],['pc',1366,900]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const medidas=await page.locator('.acoes-confirmacao').evaluate(n=>{
      const [a,b]=n.querySelectorAll('button');const r=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {a:r.height,b:s.height,distancia:s.top-r.bottom};
    });
    assert(medidas.a>=96 && medidas.b>=96 && medidas.distancia>=48);
    await capturar(page,{path:path.join(raiz,'tmp','motor-confirmacao-'+nome+'.png'),fullPage:true});
  }
  // Cancelar preserva foco e não exige mouse; Tab/Space continuam disponíveis.
  await page.keyboard.press('Escape');assert(await page.locator('[data-mensagem="agua"]').evaluate(n=>n===document.activeElement));
  await esperarIntervalo();await page.keyboard.press('Space');assert(await page.locator('#selecao-mensagem').isVisible());
  await esperarIntervalo();await page.locator('#voltar-mensagem').focus();await page.keyboard.press('Enter');assert(await page.locator('#selecao-mensagem').isHidden());
  await esperarIntervalo();await page.locator('[data-mensagem="agua"]').click();await esperarIntervalo();
  await page.locator('#confirmar-mensagem').click();
  await esperarCondicao(page,async()=>{const q=await FilaAluno.listar();return !enviando && q.length===0;});
  const pedidos=await (await admin.get('/api/pedidos')).json();assert.equal(pedidos.length,1);assert.equal(pedidos[0].aluno_id,ana.id);
  assert.equal((await page.evaluate(()=>ensaioVoz.falas)).length,0);
  await page.setViewportSize({width:1024,height:768});
  await capturar(page,{path:path.join(raiz,'tmp','motor-grade-tablet.png'),fullPage:true});
  // Perfil aplicado por aluno: sair remove a proteção e o estilo próprios.
  await esperarIntervalo();await page.locator('#trocar-aluno').click();await page.locator('#escolha-aluno').waitFor({state:'visible'});await page.waitForFunction(()=>!ocupado);
  assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('perfil-motor')),false);
  await page.locator('[data-aluno="'+bruno.id+'"]').click();await page.locator('#identidade').waitFor({state:'visible'});
  assert(await page.locator('#orientacao-motora').isHidden());
  await page.locator('[data-categoria="necessidades"]').click();await page.locator('[data-mensagem="agua"]').click();assert(await page.locator('#selecao-mensagem').isVisible());
  await page.keyboard.press('Escape');
  await post('/api/alunos/editar',{id:bruno.id,versao:1,nome:bruno.nome,perfil_acessibilidade:'baixa_visao',autorizado:true});
  await page.evaluate(()=>atualizar());
  assert(await page.locator('body').evaluate(b=>b.classList.contains('baixa-visao') && !b.classList.contains('perfil-motor')));
  await page.locator('#ajuda-baixa-visao').click();assert((await page.evaluate(()=>ensaioVoz.falas)).length>0);
  assert.deepEqual(erros,[]);
  console.log('OK técnico: perfil motor, soltura, cancelamento mouse/toque, repetição entre telas, teclado, espaçamento, envio, ausência de voz e separação entre perfis. Validação de Eduardo e tablet pendentes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(admin)await admin.dispose();if(navegador)await navegador.close();
  if(servidor){servidor.kill();await pausa(600);}
  const alvo=path.resolve(temporario);
  if(path.dirname(alvo)===path.resolve(os.tmpdir())&&path.basename(alvo).startsWith('perfil-motor-'))fs.rmSync(alvo,{recursive:true,force:true});
});
