/* Exmed Concierge · vanilla JavaScript, no build step, no external UI dependencies. */
'use strict';

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const icons = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const money = (num) => Number(num || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const numberFmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const INITIAL_QUERY = 'Preciso fazer um check-up completo do coração perto da Av. Paulista e quero gastar até R$ 300 usando meu saldo Exmed';
const state = {
  view: 'concierge', query: INITIAL_QUERY, search: null, bootstrap: null, wallet: null,
  controls: { budget:null, specialty:null, location:null, radius_km:8, use_balance:null },
  sort:'recommended', booking:null, loading:false, searchId:0
};
const VIEWS = ['home','concierge','appointments','wallet','network','benefits','help'];

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Accept': 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers }
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const detail = data?.detail;
    let error = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(x => x.msg).join(' · ') : 'Não foi possível concluir a solicitação.';
    throw new Error(error);
  }
  return data;
}
const post = (path, obj) => api(path, {method:'POST', body:JSON.stringify(obj)});

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons(type === 'error' ? 'info' : 'checkcircle')}<span>${esc(message)}</span><button aria-label="Fechar aviso">${icons('close')}</button>`;
  el.querySelector('button').onclick = () => el.remove();
  $('#toast-region').append(el);
  window.setTimeout(() => el.remove(), 5500);
}
function setActiveNavigation() {
  $$('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === state.view);
    if(el.classList.contains('topnav-active') && state.view !== 'concierge') el.classList.remove('topnav-active');
    else if (el.closest('.topnav') && el.dataset.view === 'concierge') el.classList.toggle('topnav-active', state.view === 'concierge');
  });
}
async function navigate(view, updateHash = true) {
  if (!VIEWS.includes(view)) view = 'concierge';
  state.view = view;
  if (updateHash && location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  setActiveNavigation();
  $('#sidebar').classList.remove('is-open');
  $('#floating-menu').hidden = true;
  const root = $('#view-root');
  root.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>Carregando...</p></div>`;
  try {
    if (view === 'concierge') {
      if (!state.search) await searchServices(false);
      else renderConcierge();
    } else if (view === 'appointments') {
      const data = await api('/appointments'); renderAppointments(data.items);
    } else if (view === 'wallet') {
      const [wallet, appointments] = await Promise.all([api('/wallet'), api('/appointments')]);
      state.wallet = wallet; renderWallet(wallet, appointments.items);
    } else if (view === 'network') renderNetwork();
    else if (view === 'benefits') renderBenefits();
    else if (view === 'help') renderHelp();
    else renderHome();
  } catch (e) {
    root.innerHTML = `<div class="state-error">${icons('info')}<h2>Algo não saiu como esperado</h2><p>${esc(e.message)}</p><button class="btn btn-primary" data-action="retry">Tentar novamente</button></div>`;
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

async function searchServices(rerender = true) {
  const id = ++state.searchId;
  state.loading = true;
  if (rerender) {
    const results = $('#results-region');
    if (results) results.innerHTML = `<div class="cards-loading"><div class="spinner"></div><span>Cruzando catálogo, similaridade e critérios...</span></div>`;
  }
  try {
    const data = await post('/search', {query:state.query, ...state.controls, sort:state.sort});
    if (id !== state.searchId) return;
    state.search = data;
    state.loading = false;
    renderConcierge();
  } catch (e) {
    state.loading = false;
    if (!rerender) throw e;
    toast(e.message, 'error');
    if (state.search) renderConcierge();
    else $('#view-root').innerHTML = `<div class="state-error"><h2>Busca indisponível</h2><p>${esc(e.message)}</p><button data-action="retry" class="btn btn-primary">Repetir busca</button></div>`;
  }
}
function sectionHead(kicker, title, description) {
  return `<div class="page-title-wrap"><div class="page-title-kicker">${icons('sparkles')} ${esc(kicker)} <span class="pill-ai">IA EXMED</span></div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>`;
}
function filterButton(label, value, kind, ico) {
  return `<button class="filter-chip" data-action="filter" data-filter="${kind}">${icons(ico)}<span>${esc(label)}: <b>${esc(value)}</b></span>${icons('chevron','chip-chevron')}</button>`;
}
function renderConcierge() {
  if(state.view !== 'concierge' || !state.search) return;
  const data = state.search, intent = data.intent;
  const budgetLabel = intent.budget === null || intent.budget >= 100000 ? 'Sem limite' : `Até ${money(intent.budget)}`;
  const root = $('#view-root');
  root.innerHTML = `
    <div class="content-heading"><div class="breadcrumb">Início ${icons('chevron')} <strong>Concierge inteligente</strong></div><span class="demo-note">${icons('shield')} Dados 100% fictícios</span></div>
    ${sectionHead('INTELIGÊNCIA PARA SEU CUIDADO', 'Como podemos cuidar de você hoje?', 'Descreva sua necessidade em linguagem natural. Nossa busca encontra opções no catálogo demonstrativo e ajuda você a decidir.')}
    <div class="hero-search"><form id="search-form" class="search-form"><span class="search-icon">${icons('search')}</span><textarea rows="2" id="search-text" aria-label="Descreva sua busca" placeholder="Ex.: Quero um check-up do coração até R$ 300 perto da Paulista..." maxlength="500">${esc(state.query)}</textarea><button type="button" class="search-clear" data-action="clear-search" title="Limpar pesquisa">${icons('close')}</button><button type="submit" class="btn btn-primary btn-search">${icons('sparkles')} <span>Buscar opções</span></button></form></div>
    <div class="filter-strip">${filterButton('Localização', intent.location, 'location', 'pin')}${filterButton('Orçamento', budgetLabel, 'budget', 'filter')}${filterButton('Saldo Exmed', intent.use_balance ? 'Usar saldo' : 'Opcional', 'wallet', 'wallet')}${filterButton('Especialidade', intent.specialty || 'Todas', 'specialty', 'heart')}${filterButton('Raio', `${intent.radius_km} km`, 'radius', 'pin')}</div>
    <div class="workspace-grid"><div class="results-column">
      <div class="section-row"><div><div class="eyebrow">REDE CREDENCIADA FICTÍCIA</div><h2>${data.count ? `Encontramos <em>${data.count} opções</em> para você` : 'Nenhuma opção encontrada'}</h2></div><label class="sort-wrap">Ordenar por <select id="sort-results" aria-label="Ordenar resultados"><option value="recommended" ${state.sort==='recommended'?'selected':''}>Melhor recomendação</option><option value="price" ${state.sort==='price'?'selected':''}>Menor preço</option><option value="distance" ${state.sort==='distance'?'selected':''}>Mais próximo</option><option value="rating" ${state.sort==='rating'?'selected':''}>Melhor avaliação</option></select></label></div>
      <div id="results-region" class="results-stack">${data.results.length ? data.results.map((r,i) => resultCard(r,i)).join('') : emptyResults()}</div>
      ${data.count ? `<div class="result-footnote">${icons('info')} Valores, estabelecimentos, avaliações e disponibilidade são exemplos fictícios. ${icons('link')} <button data-view="help">Como funciona a busca híbrida?</button></div>` : ''}
      <div class="inspiration"><div><div class="eyebrow">NÃO SABE O QUE PROCURAR?</div><h3>Experimente outra busca</h3></div><div class="suggestion-list">${state.bootstrap.suggestions.slice(1).map(q=>`<button class="suggestion" data-action="suggest" data-query="${esc(q)}">${icons('sparkles')} ${esc(q)} ${icons('arrow')}</button>`).join('')}</div></div>
    </div><aside class="insights-column">
      <div class="map-card"><div class="map-header"><div><span class="eyebrow">EXPLORAR NO MAPA</span><strong>Ao redor de ${esc(intent.location)}</strong></div><span class="map-range">${icons('pin')} ${intent.radius_km} km</span></div>${renderMap(data.results, intent)}</div>
      <div class="insight-card"><div class="insight-title">${icons('sparkles')} <h3>Resumo inteligente</h3></div>${renderSummary(data.summary, data.results, intent)}</div>
      <div class="wallet-mini"><div class="wallet-mini-icon">${icons('wallet')}</div><div><span>Seu saldo demonstrativo</span><strong>${money(state.wallet?.balance ?? state.bootstrap.wallet.balance)}</strong></div><button data-view="wallet" aria-label="Ver saldo">${icons('arrow')}</button></div>
      <div class="transparency">${icons('shield')} <div><strong>Recomendações rastreáveis</strong><span>Busca híbrida BM25 + semântica. Cada preço vem do catálogo local.</span></div></div>
    </aside></div>`;
}
function resultCard(item, index) {
  const top = index === 0;
  const badge = top ? `<span class="mini-tag highlight">${icons('crown')} Melhor combinação</span>` : item.distance_km < 1 ? `<span class="mini-tag">${icons('pin')} Bem pertinho</span>` : `<span class="mini-tag subtle">${icons('shield')} Rede demo</span>`;
  return `<article class="result-card ${top?'featured':''}">
      <div class="result-header"><span class="provider-avatar" style="--avatar:${esc(item.color)}">${esc(item.initials)}</span><div class="provider-identity"><h3>${esc(item.provider_name)}</h3><span>${esc(item.kind)}</span><span class="rating">${icons('star')} <b>${item.rating.toFixed(1).replace('.',',')}</b> <small>(${numberFmt(item.reviews)} avaliações fictícias)</small></span></div><div class="result-badge-group">${badge}</div></div>
      <div class="result-service"><div class="service-detail">${icons('heart')} <div><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span></div></div><div class="service-detail location-detail">${icons('pin')} <span>${esc(item.address)} · <b>${item.distance_km.toLocaleString('pt-BR')} km</b></span></div></div>
      <div class="result-bottom"><div class="price-block"><span>De <s>${money(item.original_price)}</s></span><div class="price-line"><strong>${money(item.price)}</strong><span class="discount-badge">-${item.discount_percent}%</span></div><small>Economize ${money(item.saving)}</small></div><div class="card-actions"><button class="btn btn-ghost" data-action="details" data-service="${item.id}">Ver detalhes</button><button class="btn btn-primary" data-action="book" data-service="${item.id}">${icons('calendar')} Agendar</button></div></div>
      ${top?`<div class="card-footer">${icons('sparkles')} Recomendado por relevância, distância e economia <span>${esc(item.source_id)}</span></div>`:''}
    </article>`;
}
function emptyResults() {
  return `<div class="empty-state"><div class="empty-icon">${icons('search')}</div><h3>Vamos ajustar sua busca?</h3><p>Não encontramos serviços que atendam simultaneamente à especialidade, localização e faixa de preço selecionadas.</p><button class="btn btn-primary" data-action="reset-filters">${icons('sliders')} Ampliar filtros</button></div>`;
}
function renderMap(items, intent) {
  // Illustrative sketch, not a cartographic map or geocoding service.
  const pins = items.slice(0,5).map((s,i) => {
    const x = Math.max(9, Math.min(90, 50 + (s.longitude - intent.longitude)*800));
    const y = Math.max(10, Math.min(81, 50 - (s.latitude - intent.latitude)*920));
    return `<button class="map-pin ${i===0?'selected':''}" style="left:${x}%;top:${y}%" data-action="details" data-service="${s.id}" title="${esc(s.provider_name)}">${i+1}</button>`;
  }).join('');
  return `<div class="illustrated-map"><div class="map-grid"></div><div class="map-road main-road"></div><div class="map-road road-b"></div><div class="map-road road-c"></div><div class="map-park park-one"></div><div class="map-park park-two"></div><div class="map-street street-a">AV. PAULISTA</div><div class="map-street street-b">JARDINS</div><div class="map-center" title="Centro da região escolhida"></div>${pins}<div class="map-legend">${icons('info')} Visualização ilustrativa</div></div>`;
}
function renderSummary(summary, items, intent) {
  if (!items.length) return `<div class="insight-empty"><p>${esc(summary.body)}</p><button class="mini-outline" data-action="reset-filters">Redefinir filtros ${icons('arrow')}</button></div>`;
  const best = items[0];
  return `<p class="insight-intro">${esc(summary.headline)}</p><div class="summary-list"><div>${icons('crown')} <span>Melhor escolha: <strong>${esc(best.provider_name)}</strong></span></div><div>${icons('credit')} <span>Valor estimado: <strong>${money(summary.estimated_total)}</strong></span></div><div>${icons('wallet')} <span>Saldo disponível: <strong>${money(state.wallet?.balance ?? state.bootstrap.wallet.balance)}</strong></span></div><div>${icons('pin')} <span>Distância aproximada: <strong>${best.distance_km.toLocaleString('pt-BR')} km</strong></span></div></div><div class="saving-panel">${icons('checkcircle')} <span>Economia estimada de <b>${money(summary.saving)}</b> neste pacote.</span></div><p class="insight-source">${icons('file')} Fonte: ${esc(summary.citations[0])} · ${summary.mode==='llm_grounded'?'Síntese assistida por LLM':'Síntese local auditável'}</p><button class="btn btn-primary btn-full" data-action="book" data-service="${best.id}">Agendar recomendação ${icons('arrow')}</button>`;
}

function genericHeader(kicker, title, description, action) {
  return `<div class="content-heading"><div class="breadcrumb">Início ${icons('chevron')} <strong>${esc(title)}</strong></div><span class="demo-note">${icons('shield')} Ambiente demonstrativo</span></div><div class="generic-hero"><div><div class="page-title-kicker">${icons('sparkles')} ${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action||''}</div>`;
}
function renderHome() {
  const w = state.wallet || state.bootstrap.wallet;
  $('#view-root').innerHTML = genericHeader('BEM-VINDO À EXMED', 'Cuidar de você ficou mais fácil.', 'Uma experiência inteligente para pesquisar, comparar e simular consultas e exames.', `<button data-view="concierge" class="btn btn-primary">${icons('sparkles')} Explorar concierge</button>`) +
    `<div class="metric-grid"><div class="metric"><span>Saldo disponível</span><strong>${money(w.balance)}</strong><small>Crédito fictício para simulações</small>${icons('wallet')}</div><div class="metric"><span>Serviços no catálogo</span><strong>${state.bootstrap.catalog_count}</strong><small>Opções demonstrativas</small>${icons('heart')}</div><div class="metric"><span>Parceiros exemplo</span><strong>${state.bootstrap.providers.length}</strong><small>Estabelecimentos fictícios</small>${icons('pin')}</div></div><div class="home-columns"><div class="panel-card home-cta"><div class="eyebrow">SEU PRÓXIMO PASSO</div><h2>O que você procura hoje?</h2><p>Não precisa saber o nome técnico. Descreva o que precisa e o concierge encontra alternativas para você.</p><div class="home-suggestions">${state.bootstrap.suggestions.slice(0,3).map(q => `<button data-action="suggest" data-query="${esc(q)}">${icons('search')} ${esc(q)} ${icons('arrow')}</button>`).join('')}</div></div><div class="panel-card journey-panel"><div class="eyebrow">SIMPLES ASSIM</div><h2>Da busca à reserva</h2>${[['01','Descreva sua necessidade','Busque em português, como você fala.'],['02','Compare as opções','Veja preço, especialidade e distância.'],['03','Escolha seu horário','Simule e acompanhe sua reserva.']].map(([n,t,d])=>`<div class="journey-step"><b>${n}</b><div><strong>${t}</strong><span>${d}</span></div></div>`).join('')}</div></div>`;
}
function renderAppointments(items) {
  const active = items.filter(a=>a.status==='confirmed');
  const past = items.filter(a=>a.status==='cancelled');
  const card = (a) => `<article class="appointment-card"><div class="appointment-avatar" style="--avatar:${esc(a.color)}">${esc(a.initials)}</div><div class="appointment-main"><div class="appointment-top"><strong>${esc(a.service_title)}</strong><span class="status-pill ${a.status}">${a.status==='confirmed'?'Confirmado · demo':'Cancelado'}</span></div><span>${esc(a.provider_name)} · ${esc(a.patient_name)}</span><div class="appointment-meta">${icons('calendar')} ${humanDate(a.date)} ${icons('clock')} ${esc(a.time)} ${icons('wallet')} ${money(a.amount)}</div><small>Protocolo ${esc(a.id)} · ${a.payment_method==='wallet'?'Saldo simulado':'Pagamento fictício'}</small></div>${a.status==='confirmed' ? `<button class="btn btn-ghost btn-cancel" data-action="cancel" data-appointment="${esc(a.id)}">Cancelar reserva</button>` : ''}</article>`;
  $('#view-root').innerHTML = genericHeader('SUA AGENDA', 'Meus agendamentos', 'Consulte suas reservas fictícias, confira detalhes e cancele quando quiser.', `<button data-view="concierge" class="btn btn-primary">${icons('calendar')} Novo agendamento</button>`) +
    `<div class="metric-grid compact"><div class="metric"><span>Reservas ativas</span><strong>${active.length}</strong><small>Nenhum comparecimento real</small>${icons('calendar')}</div><div class="metric"><span>Canceladas</span><strong>${past.length}</strong><small>Histórico de simulação</small>${icons('close')}</div><div class="metric"><span>Saldo atual</span><strong>${money(state.wallet?.balance ?? state.bootstrap.wallet.balance)}</strong><small>Atualiza após agendar</small>${icons('wallet')}</div></div><div class="appointments-layout"><div class="panel-card"><div class="panel-title"><h2>Reservas confirmadas</h2><span class="count-chip">${active.length}</span></div>${active.length ? active.map(card).join('') : `<div class="small-empty">${icons('calendar')} <h3>Nenhuma reserva por enquanto</h3><p>Escolha um serviço e horário no concierge para ver sua reserva aqui.</p><button data-view="concierge" class="btn btn-primary">Buscar serviços</button></div>`}</div><div class="panel-card"><div class="panel-title"><h2>Histórico</h2><span class="count-chip">${past.length}</span></div>${past.length ? past.map(card).join('') : '<p class="muted-pad">Seus cancelamentos simulados aparecerão aqui.</p>'}</div></div>`;
}
function renderWallet(wallet, appointments) {
  const charges = appointments.filter(a=>a.payment_method==='wallet');
  $('#view-root').innerHTML = genericHeader('CARTEIRA EXMED', 'Meu saldo Exmed', 'Controle o saldo de demonstração utilizado em suas reservas simuladas.', `<button data-view="concierge" class="btn btn-primary">${icons('search')} Buscar serviços</button>`) +
    `<div class="wallet-layout"><div class="wallet-card-big"><div class="wallet-card-top">${icons('wallet')} <span>EXMED PASS · DEMONSTRAÇÃO</span></div><span>Saldo disponível</span><strong>${money(wallet.balance)}</strong><small>Crédito sem valor monetário real</small><div class="wallet-card-decoration"></div><div class="wallet-card-bottom">EXMED / DEMO <span>•••• 2026</span></div></div><div class="wallet-stat-stack"><div class="metric"><span>Crédito inicial</span><strong>${money(wallet.initial_balance)}</strong><small>Saldo fictício inicial</small>${icons('wallet')}</div><div class="metric"><span>Valor em reservas ativas</span><strong>${money(wallet.spent)}</strong><small>Reembolsável ao cancelar</small>${icons('receipt')}</div></div></div><div class="panel-card wallet-transactions"><div class="panel-title"><h2>Movimentações simuladas</h2><span class="count-chip">${charges.length}</span></div>${charges.length ? charges.map(a=>`<div class="transaction"><span class="transaction-icon ${a.status==='cancelled'?'positive':''}">${icons(a.status==='cancelled'?'trending':'calendar')}</span><div><strong>${a.status==='cancelled'?'Estorno de agendamento':'Agendamento reservado'} — ${esc(a.service_title)}</strong><small>${humanDate(a.date)} · ${esc(a.id)}</small></div><b class="${a.status==='cancelled'?'plus':'minus'}">${a.status==='cancelled'?'+':'−'} ${money(a.amount)}</b></div>`).join('') : `<div class="small-empty">${icons('wallet')}<h3>Nenhuma movimentação</h3><p>Use o saldo fictício ao simular seu primeiro agendamento.</p></div>`}</div>`;
}
function renderNetwork() {
  $('#view-root').innerHTML = genericHeader('REDE DE EXEMPLO', 'Rede credenciada', 'Explore os estabelecimentos fictícios usados nesta demonstração — sem vínculo com prestadores reais.') +
    `<div class="network-summary">${icons('pin')} ${state.bootstrap.providers.length} parceiros demonstrativos em regiões de São Paulo <span>Dados exclusivamente simulados</span></div><div class="provider-grid">${state.bootstrap.providers.map(p=>`<article class="provider-tile"><span class="provider-avatar large" style="--avatar:${esc(p.color)}">${esc(p.initials)}</span><h3>${esc(p.name)}</h3><p>${esc(p.kind)}</p><div>${icons('pin')} ${esc(p.neighborhood)}</div><div>${icons('star')} ${p.rating.toFixed(1).replace('.',',')} · avaliação fictícia</div><button class="btn btn-outline btn-full" data-action="provider-details" data-provider="${p.id}">Explorar serviços ${icons('arrow')}</button></article>`).join('')}</div>`;
}
function renderBenefits() {
  const benefits = [
    ['sparkles','Busca inteligente','Descreva sua necessidade. O RAG híbrido recupera opções relevantes sem depender apenas das palavras exatas.'],
    ['wallet','Saldo demonstrativo','Teste o abatimento do saldo fictício e o reembolso automático quando cancelar uma reserva.'],
    ['shield','Preços rastreáveis','Os valores vêm do catálogo SQLite. Resultados exibem a referência do serviço consultado.'],
    ['calendar','Agendamento em segundos','Escolha data e horário livres, confirme e acompanhe todas as suas reservas.'],
    ['pin','Comparação local','Aplique distância, faixa de preço, especialidade e ordem de recomendação.'],
    ['checkcircle','Experiência sem risco','Nenhum pagamento, atendimento, avaliação ou estabelecimento desta demonstração é real.']
  ];
  $('#view-root').innerHTML = genericHeader('O QUE VOCÊ GANHA', 'Benefícios do concierge', 'Uma experiência de cuidado mais simples, transparente e personalizada.', `<button data-view="concierge" class="btn btn-primary">${icons('sparkles')} Experimentar agora</button>`) + `<div class="benefit-grid">${benefits.map(([ic,t,d])=>`<div class="benefit-card"><div class="benefit-icon">${icons(ic)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>`;
}
function renderHelp() {
  const faqs = [
    ['Essa plataforma agenda consultas de verdade?','Não. É um protótipo independente. Parceiros, endereços, preços, horários, avaliações, saldo e agendamentos são fictícios. Nenhum dado é enviado para clínicas ou operadoras.'],
    ['Como funciona o RAG híbrido?','O backend indexa descrições e metadados do catálogo SQLite. BM25 pontua correspondência lexical; vetores densos LSA calculam similaridade semântica. Reciprocal Rank Fusion (RRF) combina os rankings e filtros determinísticos aplicam orçamento, especialidade e distância. O resumo cita IDs das fontes consultadas.'],
    ['É necessário usar uma IA externa?','Não. Busca e resumos locais funcionam sem API key. Opcionalmente, o desenvolvedor pode configurar OPENAI_API_KEY para gerar um resumo com LLM, limitado às evidências retornadas pelo catálogo.'],
    ['Meu saldo é cobrado?','Não. O saldo de R$ 420 é exclusivamente fictício e armazenado no banco local. Se você escolher a carteira, o valor de demonstração é abatido; ao cancelar, retorna automaticamente.'],
    ['Posso cancelar um agendamento?','Sim, abra Agendamentos e clique em Cancelar reserva. O horário volta a ficar disponível, e o saldo é estornado se tiver sido utilizado.'],
    ['Como trocar os serviços de exemplo?','Edite app/data/seed_catalog.json antes da primeira inicialização. Caso o banco já exista, remova apenas o arquivo SQLite de demonstração (com o servidor desligado) para importar o novo catálogo.']
  ];
  $('#view-root').innerHTML = genericHeader('ESTAMOS AQUI PARA AJUDAR', 'Central de ajuda', 'Tudo o que você precisa saber sobre este ambiente de demonstração.') + `<div class="help-layout"><div class="panel-card"><div class="panel-title"><h2>Perguntas frequentes</h2></div>${faqs.map(([q,a],i)=>`<details class="faq" ${i===0?'open':''}><summary>${esc(q)}${icons('chevron')}</summary><p>${esc(a)}</p></details>`).join('')}</div><aside class="panel-card help-aside"><div class="benefit-icon">${icons('help')}</div><h3>Precisa de uma ideia?</h3><p>Você pode pesquisar por sintoma, especialidade, nome do exame ou um orçamento máximo.</p><button class="btn btn-primary btn-full" data-view="concierge">Testar a busca ${icons('arrow')}</button><div class="help-technical"><strong>Documentação técnica</strong><span>Leia o README.md incluso no ZIP, com arquitetura, API, testes e regras do RAG.</span></div></aside></div>`;
}

function humanDate(dateString) {
  const [y,m,d] = dateString.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('pt-BR', {day:'2-digit',month:'short',year:'numeric'});
}
function demoDates() {
  // Date math in the app's scheduling timezone, avoiding UTC rollover bugs.
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const pick = (name) => Number(parts.find(p => p.type === name).value);
  const year=pick('year'), month=pick('month'), day=pick('day');
  return Array.from({length:14},(_,i) => {
    const dt = new Date(Date.UTC(year,month-1,day+i,12));
    return { iso:dt.toISOString().slice(0,10), weekday:dt.toLocaleDateString('pt-BR',{weekday:'short',timeZone:'UTC'}).replace('.',''), day:dt.getUTCDate(), month:dt.toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'}).replace('.','') };
  });
}
function dialogOpen(id) { const modal = $('#' + id); if(!modal.open) modal.showModal(); }
function dialogClose(id) { const modal = $('#' + id); if(modal.open) modal.close(); }
function serviceById(id) {return state.search?.results.find(x => x.id === Number(id));}
async function detailService(id) {
  try {
    const data = await api(`/services/${encodeURIComponent(id)}`);
    const s = data.service;
    $('#detail-content').innerHTML = `<div class="modal-head"><span class="modal-kicker">DETALHES DO SERVIÇO</span><button class="icon-button" data-action="close-detail" aria-label="Fechar">${icons('close')}</button></div><div class="detail-provider"><span class="provider-avatar large" style="--avatar:${esc(s.color)}">${esc(s.initials)}</span><div><h2>${esc(s.title)}</h2><p>${esc(s.provider_name)} · ${esc(s.kind)}</p></div></div><div class="detail-pills"><span>${icons('heart')} ${esc(s.specialty)}</span><span>${icons('clock')} Duração aproximada: ${s.duration_minutes} min</span><span>${icons('shield')} Exemplo fictício</span></div><div class="detail-section"><h3>O que está incluído</h3><p>${esc(s.description)}</p></div><div class="detail-section"><h3>Local de referência</h3><p>${icons('pin')} ${esc(s.address)}</p></div><div class="source-box">${icons('file')} Evidência consultável: <b>${esc(s.source_id)}</b><span>Preço e desconto originados do catálogo local SQLite.</span></div><div class="detail-price"><div><span>Valor de referência <s>${money(s.original_price)}</s></span><strong>${money(s.price)}</strong><small>Economia demonstrativa de ${money(s.saving)}</small></div><button class="btn btn-primary" data-action="book" data-service="${s.id}">${icons('calendar')} Agendar</button></div>`;
    dialogOpen('detail-dialog');
  } catch (e) {toast(e.message,'error');}
}
async function providerDetails(id) {
  const p = state.bootstrap.providers.find(p=>p.id===Number(id));
  if (!p) return;
  try {
    const data = await api(`/providers/${p.id}/services`);
    const catalog = data.services;
    $('#detail-content').innerHTML = `<div class="modal-head"><span class="modal-kicker">REDE DE DEMONSTRAÇÃO</span><button class="icon-button" data-action="close-detail">${icons('close')}</button></div><div class="detail-provider"><span class="provider-avatar large" style="--avatar:${esc(p.color)}">${esc(p.initials)}</span><div><h2>${esc(p.name)}</h2><p>${esc(p.kind)} · ${esc(p.neighborhood)}</p></div></div><p class="provider-note">${esc(p.address)}. Este estabelecimento é fictício.</p><div class="detail-section"><h3>Serviços disponíveis</h3>${catalog.map(s=>`<div class="service-line"><div><strong>${esc(s.title)}</strong><small>${esc(s.specialty)} · ${money(s.price)}</small></div><button class="btn btn-outline" data-action="book" data-service="${s.id}">Agendar ${icons('arrow')}</button></div>`).join('')}</div>`;
    dialogOpen('detail-dialog');
  } catch(e) {toast(e.message,'error');}
}
async function startBooking(id) {
  try {
    const s = (await api(`/services/${encodeURIComponent(id)}`)).service;
    dialogClose('detail-dialog');
    const dates = demoDates();
    const defaultDate = dates.find((d, idx)=>idx > 0 && new Date(d.iso+'T12:00:00Z').getUTCDay() !== 0)?.iso || dates[1].iso;
    state.booking = {service:s, date:defaultDate, slot:null, payment:'wallet', slots:[], loading:true};
    renderBooking(); dialogOpen('booking-dialog');
    await updateSlots();
  } catch(e) {toast(e.message,'error');}
}
async function updateSlots() {
  const booking = state.booking;
  if(!booking) return;
  booking.loading = true; booking.slot = null; renderBooking();
  const date = booking.date;
  try {
    const data = await api(`/slots?service_id=${booking.service.id}&day=${date}`);
    if (state.booking !== booking || booking.date !== date) return;
    booking.slots = data.slots; booking.loading = false; renderBooking();
  } catch(e) {booking.loading=false; booking.slots=[]; renderBooking(); toast(e.message,'error');}
}
function renderBooking() {
  const b = state.booking; if(!b) return;
  const dates = demoDates();
  const wallet = state.wallet?.balance ?? state.bootstrap.wallet.balance;
  const hasBalance = wallet + 0.001 >= b.service.price;
  $('#booking-content').innerHTML = `<div class="modal-head"><span class="modal-kicker">AGENDAMENTO · DEMONSTRAÇÃO</span><button class="icon-button" data-action="close-booking" aria-label="Fechar">${icons('close')}</button></div><div class="booking-progress"><span class="is-current">1. Escolha a data</span><span>2. Seus dados</span><span>3. Confirmação</span></div><div class="booking-service"><span class="provider-avatar" style="--avatar:${esc(b.service.color)}">${esc(b.service.initials)}</span><div><h2>${esc(b.service.title)}</h2><p>${esc(b.service.provider_name)}</p></div><strong>${money(b.service.price)}</strong></div><form id="booking-form"><div class="field-heading"><h3>Escolha uma data</h3><small>Próximos 14 dias · Horário de São Paulo</small></div><div class="date-row">${dates.map(d=>`<button type="button" data-action="choose-day" data-day="${d.iso}" class="date-chip ${d.iso===b.date?'selected':''}"><span>${esc(d.weekday)}</span><strong>${d.day}</strong><small>${esc(d.month)}</small></button>`).join('')}</div><div class="field-heading slots-heading"><h3>Horários disponíveis</h3><small>Horários e vagas fictícios</small></div><div class="slots-grid">${b.loading?`<span class="slots-loading"><span class="spinner tiny"></span> Consultando vagas...</span>`:b.slots.length?b.slots.map(s=>`<button type="button" data-action="choose-slot" data-slot="${s.time}" ${!s.available?'disabled':''} class="slot-chip ${b.slot===s.time?'selected':''}">${icons('clock')} ${esc(s.time)}</button>`).join(''):'<span class="muted-pad">Sem horários nesta data. Escolha outro dia.</span>'}</div><div class="modal-fields"><div class="field-heading"><h3>Dados do paciente</h3><small>Não use informações sensíveis reais</small></div><div class="field-two"><label>Nome para a reserva<input name="patient_name" minlength="3" maxlength="100" placeholder="Ex.: Pessoa de Teste" required autocomplete="off"/></label><label>E-mail (opcional)<input name="patient_email" type="email" maxlength="150" placeholder="teste@exemplo.com" autocomplete="off"/></label></div></div><div class="field-heading payment-heading"><h3>Forma de pagamento</h3><small>Nenhuma cobrança real</small></div><div class="payment-choices"><button type="button" class="payment-option ${b.payment==='wallet'?'selected':''} ${!hasBalance?'insufficient':''}" data-action="payment" data-payment="wallet"><span>${icons('wallet')}</span><div><strong>Saldo Exmed</strong><small>Disponível: ${money(wallet)}${!hasBalance?' · Insuficiente':''}</small></div>${icons(b.payment==='wallet'?'checkcircle':'chevron')}</button><button type="button" class="payment-option ${b.payment==='demo'?'selected':''}" data-action="payment" data-payment="demo"><span>${icons('credit')}</span><div><strong>Pagamento fictício</strong><small>Simulação sem transação</small></div>${icons(b.payment==='demo'?'checkcircle':'chevron')}</button></div><div class="booking-total"><div><span>Total da simulação</span><strong>${money(b.service.price)}</strong></div><span class="discount-badge">-${b.service.discount_percent}% no catálogo</span></div><button type="submit" class="btn btn-primary btn-full btn-confirm" ${!b.slot || b.loading || (b.payment==='wallet'&&!hasBalance)?'disabled':''}>${icons('checkcircle')} Confirmar agendamento fictício</button><p class="disclaimer-center">${icons('shield')} Sem atendimento, cobrança ou confirmação externa.</p></form>`;
}
async function submitBooking(form) {
  const b=state.booking;
  if (!b?.slot) {toast('Selecione um horário disponível.', 'error');return;}
  const submit=$('.btn-confirm',form); submit.disabled=true; submit.textContent='Confirmando reserva...';
  const values=new FormData(form);
  try {
    const confirmation = await post('/appointments', {service_id:b.service.id, date:b.date,time:b.slot,
      patient_name:values.get('patient_name'), patient_email:values.get('patient_email'),payment_method:b.payment});
    state.wallet = confirmation.wallet;
    $('#booking-content').innerHTML = `<div class="booking-success"><button class="icon-button close-success" data-action="close-booking" aria-label="Fechar">${icons('close')}</button><div class="success-circle">${icons('check')}</div><span class="modal-kicker">SIMULAÇÃO CONCLUÍDA</span><h2>Seu agendamento está confirmado!</h2><p>Reserva fictícia criada com sucesso. Você pode gerenciá-la a qualquer momento.</p><div class="success-receipt"><div><span>Protocolo</span><b>${esc(confirmation.id)}</b></div><div><span>Serviço</span><b>${esc(confirmation.service)}</b></div><div><span>Local</span><b>${esc(confirmation.provider)}</b></div><div><span>Data e horário</span><b>${humanDate(confirmation.date)} · ${confirmation.time}</b></div><div><span>Valor simulado</span><b>${money(confirmation.amount)}</b></div></div><button class="btn btn-primary btn-full" data-action="go-appointments">Ver meus agendamentos ${icons('arrow')}</button><button class="btn btn-text btn-full" data-action="close-booking">Voltar ao concierge</button></div>`;
    toast('Agendamento fictício criado com sucesso!');
  } catch(e) {
    toast(e.message, 'error');
    await updateSlots();
  }
}
async function cancelBooking(id) {
  if (!window.confirm('Cancelar esta reserva fictícia? Caso tenha utilizado o saldo, ele será estornado.')) return;
  try { const result=await post(`/appointments/${encodeURIComponent(id)}/cancel`,{});state.wallet=result.wallet;toast(result.refunded?'Reserva cancelada. Saldo estornado.':'Reserva fictícia cancelada.');navigate('appointments',false); }
  catch(e){toast(e.message,'error');}
}
function openFilter(button) {
  const kind=button.dataset.filter, intent=state.search.intent;
  let choices=[];
  if(kind==='location') choices=state.bootstrap.locations.map(v=>[v,v]);
  if(kind==='budget') choices=[[100000,'Sem limite'],[100,'Até R$ 100'],[200,'Até R$ 200'],[300,'Até R$ 300'],[400,'Até R$ 400'],[500,'Até R$ 500']];
  if(kind==='specialty') choices=[['Todas','Todas as especialidades'],...state.bootstrap.specialties.map(v=>[v,v])];
  if(kind==='radius') choices=[[2,'Até 2 km'],[5,'Até 5 km'],[8,'Até 8 km'],[15,'Até 15 km'],[40,'Até 40 km']];
  if(kind==='wallet') choices=[[true,'Considerar meu saldo'],[false,'Não considerar saldo']];
  const current=kind==='radius'?intent.radius_km:kind==='wallet'?intent.use_balance:kind==='specialty'?(intent.specialty||'Todas'):intent[kind];
  const menu=$('#floating-menu');
  menu.innerHTML=`<div class="filter-menu-title">${esc({location:'Selecionar região',budget:'Faixa de orçamento',specialty:'Especialidade',radius:'Distância máxima',wallet:'Usar saldo Exmed'}[kind])}</div>${choices.map(([value,label])=>`<button data-action="apply-filter" data-filter="${kind}" data-value="${esc(value)}" class="${String(current)===String(value)?'chosen':''}">${esc(label)}${String(current)===String(value)?icons('check'):''}</button>`).join('')}`;
  menu.hidden=false;
  const r=button.getBoundingClientRect();
  menu.style.left=Math.max(12,Math.min(r.left,window.innerWidth-270))+'px';
  menu.style.top=Math.min(r.bottom+8,window.innerHeight-Math.min(320,choices.length*47+70)-12)+'px';
}
function applyFilter(kind,value) {
  $('#floating-menu').hidden=true;
  if(kind==='budget'||kind==='radius') state.controls[kind==='radius'?'radius_km':'budget']=Number(value);
  else if(kind==='wallet') state.controls.use_balance=(value==='true');
  else state.controls[kind]=value;
  searchServices();
}
function suggestSearch(value) {
  state.query=value;state.controls={budget:null,specialty:null,location:null,radius_km:8,use_balance:null};state.sort='recommended';state.search=null;
  navigate('concierge');
}
function floatingMessage(type) {
  const menu=$('#floating-menu');
  const anchor=$(`[data-action="${type}"]`),r=anchor?.getBoundingClientRect();
  if(!r)return;
  menu.innerHTML=type==='notifications'?`<div class="filter-menu-title">${icons('bell')} Notificações</div><div class="popover-text">${icons('checkcircle')} Seu ambiente de testes está ativo. Suas reservas simuladas ficam salvas localmente.</div><button data-view="appointments">Ver agendamentos ${icons('arrow')}</button>`:`<div class="filter-menu-title">Perfil demonstrativo</div><div class="popover-text">${icons('shield')} Navegação de teste, sem autenticação e sem dados de operadora real.</div><button data-view="wallet">Ver carteira ${icons('arrow')}</button>`;
  menu.hidden=false;
  menu.style.left=Math.max(12,Math.min(r.right-260,window.innerWidth-275))+'px';menu.style.top=(r.bottom+12)+'px';
}

// Delegation works for every view and every modal, including content created after an API call.
document.addEventListener('click', async (event) => {
  const view=event.target.closest('[data-view]');
  if(view){event.preventDefault();navigate(view.dataset.view);return;}
  const btn=event.target.closest('[data-action]');
  if(!btn){if(!event.target.closest('#floating-menu'))$('#floating-menu').hidden=true;return;}
  const {action}=btn.dataset;
  if(action==='toggle-menu'){$('#sidebar').classList.toggle('is-open');return;}
  if(action==='retry'){navigate(state.view,false);return;}
  if(action==='clear-search'){$('#search-text').value='';$('#search-text').focus();return;}
  if(action==='filter'){openFilter(btn);return;}
  if(action==='apply-filter'){applyFilter(btn.dataset.filter,btn.dataset.value);return;}
  if(action==='reset-filters'){state.controls={budget:100000,specialty:'Todas',location:'Av. Paulista',radius_km:40,use_balance:false};searchServices();return;}
  if(action==='suggest'){suggestSearch(btn.dataset.query);return;}
  if(action==='notifications'||action==='profile'){floatingMessage(action);return;}
  if(action==='details'){detailService(btn.dataset.service);return;}
  if(action==='provider-details'){providerDetails(btn.dataset.provider);return;}
  if(action==='book'){startBooking(btn.dataset.service);return;}
  if(action==='close-detail'){dialogClose('detail-dialog');return;}
  if(action==='close-booking'){dialogClose('booking-dialog');return;}
  if(action==='go-appointments'){dialogClose('booking-dialog');navigate('appointments');return;}
  if(action==='choose-day'){const name=$('[name="patient_name"]')?.value||'',email=$('[name="patient_email"]')?.value||'';state.booking.date=btn.dataset.day;await updateSlots();if($('[name="patient_name"]'))$('[name="patient_name"]').value=name;if($('[name="patient_email"]'))$('[name="patient_email"]').value=email;return;}
  if(action==='choose-slot'){state.booking.slot=btn.dataset.slot;
    const name=$('[name="patient_name"]')?.value||'',email=$('[name="patient_email"]')?.value||'';
    renderBooking();$('[name="patient_name"]').value=name;$('[name="patient_email"]').value=email;return;}
  if(action==='payment'){state.booking.payment=btn.dataset.payment;
    const name=$('[name="patient_name"]')?.value||'',email=$('[name="patient_email"]')?.value||'';
    renderBooking();$('[name="patient_name"]').value=name;$('[name="patient_email"]').value=email;return;}
  if(action==='cancel'){cancelBooking(btn.dataset.appointment);return;}
});
document.addEventListener('submit', event => {
  if(event.target.id==='search-form'){
    event.preventDefault();state.query=$('#search-text').value.trim();
    if(!state.query){toast('Digite o que você procura para iniciar a busca.','error');return;}
    state.controls={budget:null,specialty:null,location:null,radius_km:8,use_balance:null};searchServices();
  }
  if(event.target.id==='booking-form'){event.preventDefault();submitBooking(event.target);}
});
document.addEventListener('change', event => {
  if(event.target.id==='sort-results'){state.sort=event.target.value;searchServices();}
});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(VIEWS.includes(view)&&view!==state.view)navigate(view,false);});
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();}));

(async function boot() {
  try {
    state.bootstrap=await api('/bootstrap');state.wallet=state.bootstrap.wallet;
    const hash=location.hash.replace('#','');
    await navigate(VIEWS.includes(hash)?hash:'concierge',false);
  } catch(e) {
    $('#view-root').innerHTML=`<div class="state-error">${icons('info')}<h2>Não foi possível conectar à API</h2><p>${esc(e.message)}</p><p>Confira se o servidor Python está ativo em <code>http://127.0.0.1:8000</code>.</p><button class="btn btn-primary" onclick="location.reload()">Reconectar</button></div>`;
  }
})();
