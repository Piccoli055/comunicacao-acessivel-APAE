"use strict";
// Fila persistente por origem/navegador, sem nomes, fotos ou credenciais.
const FilaAluno = (() => {
  let abertura;
  function abrir() {
    if (abertura) return abertura;
    abertura = new Promise((resolve,reject) => {
      let encerrado = false;
      const falhar = () => { encerrado = true; reject(new Error('Não foi possível acessar a fila deste navegador.')); };
      const tempo = setTimeout(falhar,5000);
      let pedido;
      try { pedido = indexedDB.open('comunicador-fila',1); }
      catch (_) { clearTimeout(tempo); falhar(); return; }
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('pedidos',{keyPath:'id'});
      pedido.onerror = pedido.onblocked = () => { clearTimeout(tempo); falhar(); };
      pedido.onsuccess = () => {
        clearTimeout(tempo);
        if (encerrado) { pedido.result.close(); return; }
        pedido.result.onversionchange = () => { pedido.result.close(); abertura = null; };
        resolve(pedido.result);
      };
    }).catch(erro => { abertura = null; throw erro; });
    return abertura;
  }
  async function operar(modo,acao) {
    const db = await abrir();
    return new Promise((resolve,reject) => {
      const transacao = db.transaction('pedidos',modo);
      const pedido = acao(transacao.objectStore('pedidos'));
      transacao.oncomplete = () => resolve(pedido.result);
      transacao.onerror = transacao.onabort = () => reject(new Error('Não foi possível salvar a fila neste navegador.'));
    });
  }
  return {
    listar: () => operar('readonly',loja => loja.getAll()),
    salvar: pedido => operar('readwrite',loja => loja.put(pedido)),
    remover: id => operar('readwrite',loja => loja.delete(id)),
    limpar: () => operar('readwrite',loja => loja.clear()),
  };
})();
