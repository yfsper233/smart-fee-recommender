import { copy } from './copy.mjs';
import { buildDistribution, minimumForPriority, recommendRate, recommendCumulative, DEFAULT_RECOMMENDATION_POLICY } from './solver.mjs';
import { applyProjectedBlock } from './protocol.mjs';

const byId = id => document.getElementById(id);
const text = (id, value) => { byId(id).textContent = value; };
const number = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n);
const rate = n => n.toFixed(2);
const bindings = {
  'page-title':'title', 'target-label':'target', 'priority-description':'priorityDescription',
  'chart-title':'chart', 'requirements-title':'requirements',
  'requirement-heading':'requirement', 'quote-heading':'quote', 'attained-heading':'attained',
  'rules-label':'solverDetail', precision:'precision', 'source-link':'sourceLink', 'graph-link':'graphLink',
  'marginal-title':'marginalTitle', 'marginal-step-label':'marginalStep',
  'recommendation-title':'recommended', 'window-explanation':'windowExplanation',
  'cumulative-title':'cumulative', 'cumulative-explanation':'cumulativeExplanation',
  'cumulative-chart-title':'cumulativeChart',
};
for (const [id, key] of Object.entries(bindings)) text(id, copy[key]);
document.title = copy.title;
document.querySelectorAll('.unit').forEach(el => { el.textContent = copy.rateUnit; });
for (const [selector,key] of [['.cost-label','costLabel'],['.efficiency-label','efficiencyLabel'],['.efficiency-unit','efficiencyUnit']]) {
  document.querySelectorAll(selector).forEach(el=>{el.textContent=copy[key];});
}
for (const ticks of [1,5,10]) {
  const option = document.createElement('option');
  option.value = ticks; option.textContent = copy.rateOption(rate(ticks / 100));
  byId('marginal-step').append(option);
}
for (const key of ['priorityRule','quoteRule','recommendationRule','cumulativeRule','metricsRule','searchRule','chartRule']) {
  const li = document.createElement('li'); li.textContent = copy[key]; byId('rules').append(li);
}
for (const key of ['recommended','cumulative','minimum']) {
  const span = document.createElement('span'); span.className = key;
  const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true');
  span.append(icon, document.createTextNode(copy[key])); byId('chart-legend').append(span);
}
let state = null, distribution = null, observedAt = 0, socket = null;
let target = DEFAULT_RECOMMENDATION_POLICY.minimumPriority, status = 'connecting', reconnect = null, attempts = 0, syncRequestedAt = 0;
let minimum = null, marginal = null, recommendation = null, cumulative = null, drawScheduled = false, lastRenderAt = 0;
const endpoint = 'wss://mempool.space/api/v1/ws';
function updateStatus() {
  const age = observedAt ? Math.floor((Date.now() - observedAt) / 1000) : null;
  const visibleStatus = status === 'live' && age > 60 ? 'stale' : status;
  text('status', copy[visibleStatus]);
  byId('status').dataset.state = visibleStatus;
  if (distribution) {
    const time = new Date(observedAt).toLocaleTimeString('zh-CN', { hour12:false, timeZone:'Asia/Shanghai' });
    text('observation', [copy.count(distribution.transactionCount), copy.weight(distribution.totalWeight), copy.updated(time), copy.secondsAgo(age)].join(' · '));
  } else text('observation', copy.source);
  renderRecommendation(visibleStatus === 'live');
}
function renderRecommendation(available) {
  const ready=available && recommendation && cumulative;
  byId('result-notice').hidden=Boolean(ready);
  if(!ready){
    text('result-notice',copy.recommendationUnavailable);text('search-range',copy.pending);
    for(const [prefix,rateId,priorityId] of [['window','recommended-rate','recommended-priority'],['cumulative','cumulative-rate','cumulative-priority']]){
      text(rateId,'—');text(priorityId,'');text(prefix+'-cost','—');text(prefix+'-efficiency','—');text(prefix+'-note','');
    }
    return;
  }
  text('result-notice','');
  const base=cumulative.baseline;
  text('search-range',copy.searchRange(rate(base.feeRate),number(base.priority),rate(cumulative.searchLimit.feeRate)));
  for(const [prefix,rateId,priorityId,point] of [
    ['window','recommended-rate','recommended-priority',recommendation.recommended],
    ['cumulative','cumulative-rate','cumulative-priority',cumulative.recommended],
  ]){
    const cost=(point.ticks-base.ticks)/100,gain=point.priority-base.priority;
    text(rateId,rate(point.feeRate));text(priorityId,copy.recommendationPriority(number(point.priority)));
    text(prefix+'-cost',rate(cost));text(prefix+'-efficiency',cost>0?number(gain/cost):'—');
    text(prefix+'-note',point.ticks===base.ticks?copy.atBaseline:'');
  }
}
function requestFull() {
  if (socket?.readyState === WebSocket.OPEN) {
    syncRequestedAt = Date.now();
    socket.send(JSON.stringify({ 'track-mempool-block':0 }));
  }
}
function connect() {
  clearTimeout(reconnect);
  status = observedAt ? 'reconnecting' : 'connecting'; updateStatus();
  const current = new WebSocket(endpoint); socket = current;
  current.addEventListener('open', () => { attempts = 0; state = null; status = 'syncing'; updateStatus(); requestFull(); });
  current.addEventListener('message', event => {
    if (socket !== current) return;
    try {
      const response = JSON.parse(event.data);
      const payload = response['projected-block-transactions'];
      if (!payload || payload.index !== 0) return;
      // A reconnect or sequence gap requires a fresh complete transaction set.
      state = applyProjectedBlock(state, payload);
      distribution = buildDistribution([...state.transactions.values()]);
      observedAt = Date.now(); status = distribution ? 'live' : 'empty';
      scheduleRender();
    } catch (error) {
      console.warn('snapshot_resynchronization', error.message);
      state = null; status = 'syncing'; updateStatus();
      if (Date.now() - syncRequestedAt > 1000) requestFull();
    }
  });
  current.addEventListener('error', () => current.close());
  current.addEventListener('close', () => {
    if (socket !== current) return;
    status = 'reconnecting'; state = null; updateStatus();
    reconnect = setTimeout(connect, Math.min(30000, 1500 * 2 ** Math.min(attempts++, 4)));
  });
}
setInterval(() => {
  updateStatus();
  if (socket?.readyState === WebSocket.OPEN && Date.now() - Math.max(observedAt, syncRequestedAt) > 45000) requestFull();
}, 1000);

function scheduleRender() {
  if (drawScheduled) return;
  drawScheduled = true;
  setTimeout(() => {
    drawScheduled = false; lastRenderAt = Date.now(); render();
  }, Math.max(0, 200 - (Date.now() - lastRenderAt)));
}
byId('target').addEventListener('input', event => {
  target = Number(event.target.value); render();
});
byId('marginal-step').addEventListener('change',render);

const NS = 'http://www.w3.org/2000/svg';
function svgElement(name, attrs = {}, value) {
  const el = document.createElementNS(NS, name);
  for (const [key, v] of Object.entries(attrs)) el.setAttribute(key, String(v));
  if (value !== undefined) el.textContent = value;
  return el;
}
function drawChart() {
  const svg = byId('chart'); svg.replaceChildren();
  const width = Math.max(280, byId('chart-host').clientWidth), height = width < 420 ? 270 : 300;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-label', copy.chartDescription);
  svg.style.height = height + 'px';
  svg.append(svgElement('title', {}, copy.chart));
  if (!distribution) {
    svg.append(svgElement('text', {x:width/2, y:height/2, 'text-anchor':'middle'}, copy.pending)); return;
  }
  const margin = {left:65, right:22, top:30, bottom:55};
  const box = {left:margin.left, right:width-margin.right, top:margin.top, bottom:height-margin.bottom};
  const allRates = [...distribution.groups.map(g=>g.rate), ...(minimum ? [minimum.feeRate] : []),
    ...(recommendation ? [recommendation.recommended.feeRate] : []),
    ...(cumulative ? [cumulative.recommended.feeRate] : [])];
  const positives = allRates.filter(r=>r>0);
  const minimumRate = Math.min(...positives), maximum = Math.max(...positives);
  const logLow = Math.log10(minimumRate) - 0.12, logHigh = Math.log10(maximum) + 0.13;
  const logSpan = Math.max(0.25, logHigh - logLow);
  const x = p => box.left + p/100*(box.right-box.left);
  const y = r => r === 0 ? box.bottom : box.bottom - (Math.log10(r)-logLow)/logSpan*(box.bottom-box.top);
  const xTicks = width < 420 ? [0,50,100] : [0,20,40,60,80,100];
  for (const p of xTicks) {
    svg.append(svgElement('line', {x1:x(p),y1:box.top,x2:x(p),y2:box.bottom,class:'grid'}));
    svg.append(svgElement('text', {x:x(p),y:box.bottom+22,'text-anchor':'middle'}, p));
  }
  const yCandidates = [];
  for (let exponent=Math.floor(logLow); exponent<=Math.ceil(logHigh); exponent++) {
    for (const multiplier of [1,2,5]) {
      const value = multiplier*10**exponent;
      if (value >= 10**logLow && value <= 10**(logLow+logSpan)) yCandidates.push(value);
    }
  }
  const yTicks = [];
  for (const value of yCandidates.sort((a,b)=>a-b)) {
    if (!yTicks.length || Math.abs(y(value)-y(yTicks.at(-1)))>=24) yTicks.push(value);
  }
  for (const value of yTicks) {
    svg.append(svgElement('line', {x1:box.left,y1:y(value),x2:box.right,y2:y(value),class:'grid'}));
    svg.append(svgElement('text', {x:box.left-9,y:y(value)+4,'text-anchor':'end'}, number(value)));
  }
  svg.append(svgElement('rect', {x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,class:'frame','data-chart-frame':''}));
  svg.append(svgElement('text', {x:box.left,y:14}, copy.yAxis));
  svg.append(svgElement('text', {x:(box.left+box.right)/2,y:height-8,'text-anchor':'middle','data-axis':'x',class:'axis-title'}, copy.xAxis));
  const vertices = [];
  for (const group of distribution.groups) {
    vertices.push([x(group.before/distribution.totalWeight*100),y(group.rate)]);
    vertices.push([x(group.after/distribution.totalWeight*100),y(group.rate)]);
  }
  svg.append(svgElement('path', {d:vertices.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '),class:'curve'}));
  svg.append(svgElement('line', {x1:x(target),x2:x(target),y1:box.top,y2:box.bottom,class:'target'}));
  svg.append(svgElement('text', {x:box.right,y:14,'text-anchor':'end','data-label':'target'}, copy.thresholdLabel(target)));
  const marks = minimum ? [['minimum',minimum,'diamond']] : [];
  if(cumulative)marks.push(['cumulative',cumulative.recommended,'ring']);
  if(recommendation)marks.push(['recommended',recommendation.recommended,'star']);
  for (const [name,p,shape] of marks) {
    const cx=x(p.priority), cy=y(p.feeRate);
    const radius=6;
    const attrs = {class:name+'-point'};
    const mark = shape==='ring' ? svgElement('circle',{...attrs,cx,cy,r:13})
      : shape==='circle' ? svgElement('circle',{...attrs,cx,cy,r:radius})
      : shape==='diamond' ? svgElement('path',{...attrs,d:`M${cx},${cy-radius-2} l${radius+2},${radius+2} l${-radius-2},${radius+2} l${-radius-2},${-radius-2} Z`})
      : shape==='cross' ? svgElement('path',{...attrs,d:`M${cx-5},${cy} h10 M${cx},${cy-5} v10`})
      : shape==='triangle' ? svgElement('path',{...attrs,d:`M${cx},${cy-8} l8,14 h-16 Z`})
      : shape==='star' ? svgElement('path',{...attrs,d:Array.from({length:10},(_,i)=>{
        const angle=-Math.PI/2+i*Math.PI/5,r=i%2?4.5:11;
        return `${i?'L':'M'}${cx+Math.cos(angle)*r},${cy+Math.sin(angle)*r}`;
      }).join(' ')+' Z'})
      : svgElement('path',{...attrs,d:`M${cx-10},${cy-10} h20 M${cx-10},${cy+10} h20`});
    svg.append(mark);
    mark.append(svgElement('title',{},copy.marker(copy[name],rate(p.feeRate),number(p.priority))));
  }
  const tooltip = byId('tooltip'); tooltip.hidden = true;
  const overlay = svgElement('rect',{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,class:'hit'});
  function inspect(event) {
    const rect=svg.getBoundingClientRect();
    const localX=(event.clientX-rect.left)*width/rect.width;
    const percentile=Math.max(0,Math.min(100,(localX-box.left)/(box.right-box.left)*100));
    const group=distribution.groups.find(g=>g.after/distribution.totalWeight*100>=percentile) || distribution.groups.at(-1);
    tooltip.textContent=copy.groupTooltip(rate(group.rate),number(group.before/distribution.totalWeight*100),number(group.after/distribution.totalWeight*100));
    tooltip.hidden=false;
    tooltip.style.left=Math.max(0,Math.min(width-250,localX+10))+'px';
    tooltip.style.top=Math.max(0,y(group.rate)-40)+'px';
  }
  overlay.addEventListener('pointermove',inspect);
  overlay.addEventListener('pointerdown',inspect);
  overlay.addEventListener('pointerleave',()=>{tooltip.hidden=true;});
  svg.append(overlay);
}

function drawMarginalChart() {
  const svg=byId('marginal-chart');svg.replaceChildren();
  const width=Math.max(280,byId('marginal-chart-host').clientWidth),height=width<420?245:255;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.height=height+'px';
  svg.setAttribute('aria-label',copy.marginalDescription);
  svg.append(svgElement('title',{},copy.marginalTitle));
  if(!marginal){svg.append(svgElement('text',{x:width/2,y:height/2,'text-anchor':'middle'},copy.pending));return;}
  const box={left:65,right:width-22,top:32,bottom:height-55};
  const low=marginal.startTicks/100,high=marginal.endTicks/100;
  const x=f=>box.left+(Math.log10(f)-Math.log10(low))/(Math.log10(high)-Math.log10(low))*(box.right-box.left);
  const maximum=Math.max(0,...marginal.segments.map(s=>s.efficiency));
  const magnitude=maximum>0?10**Math.floor(Math.log10(maximum)):1;
  const ceiling=maximum>0?Math.ceil(maximum/magnitude)*magnitude:1;
  const y=value=>box.bottom-value/(ceiling*1.12)*(box.bottom-box.top);
  for(const value of [0,ceiling/4,ceiling/2,ceiling*3/4,ceiling]){
    svg.append(svgElement('line',{x1:box.left,x2:box.right,y1:y(value),y2:y(value),class:'grid'}));
    svg.append(svgElement('text',{x:box.left-9,y:y(value)+4,'text-anchor':'end'},number(value)));
  }
  const candidates=[low];
  for(let exponent=Math.floor(Math.log10(low));exponent<=Math.ceil(Math.log10(high));exponent++)for(const k of [1,2,5]){
    const f=k*10**exponent;if(f>low&&f<high)candidates.push(f);
  }
  const ticks=[];
  for(const f of candidates.sort((a,b)=>a-b))if(!ticks.length||x(f)-x(ticks.at(-1))>=70)ticks.push(f);
  if(ticks.length>1&&x(high)-x(ticks.at(-1))<65)ticks.pop();
  if(x(high)-x(ticks.at(-1))>=45)ticks.push(high);
  for(const f of ticks){
    svg.append(svgElement('line',{x1:x(f),x2:x(f),y1:box.top,y2:box.bottom,class:'grid'}));
    svg.append(svgElement('text',{x:x(f),y:box.bottom+22,'text-anchor':f===low?'start':f===high?'end':'middle'},number(f)));
  }
  svg.append(svgElement('rect',{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,class:'frame'}));
  svg.append(svgElement('text',{x:box.left,y:14},copy.marginalYAxis));
  svg.append(svgElement('text',{x:(box.left+box.right)/2,y:height-8,'text-anchor':'middle'},copy.marginalXAxis));
  const vertices=[];
  for(const s of marginal.segments){vertices.push([x(s.startTicks/100),y(s.efficiency)],[x(s.endTicks/100),y(s.efficiency)]);}
  svg.append(svgElement('path',{d:vertices.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '),class:'marginal-line'}));
  if(marginal.peak){
    const peak=marginal.peak,cx=x(peak.start.feeRate),cy=y(peak.efficiency);
    svg.append(svgElement('line',{x1:cx,x2:cx,y1:cy,y2:box.bottom,class:'target'}));
    const mark=svgElement('circle',{cx,cy,r:5,class:'marginal-dot'});
    mark.append(svgElement('title',{},copy.marginalSummary(rate(peak.start.feeRate),rate(peak.end.feeRate),number(peak.start.priority),number(peak.end.priority),number(peak.gain),number(peak.efficiency))));
    svg.append(mark);
  }
}

function drawCumulativeChart() {
  const svg=byId('cumulative-chart');svg.replaceChildren();
  const width=Math.max(280,byId('cumulative-chart-host').clientWidth),height=width<420?245:255;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.height=height+'px';
  svg.setAttribute('aria-label',copy.cumulativeChartDescription);
  svg.append(svgElement('title',{},copy.cumulativeChart));
  if(!cumulative || !cumulative.peak){
    const message=cumulative?copy.cumulativeEmpty:copy.pending;
    svg.append(svgElement('text',{x:width/2,y:height/2,'text-anchor':'middle'},message));
    text('cumulative-caption',message);return;
  }
  const base=cumulative.baseline,points=cumulative.candidates;
  const box={left:65,right:width-22,top:32,bottom:height-55};
  const low=base.feeRate,high=cumulative.searchLimit.feeRate;
  const x=f=>box.left+(f-low)/(high-low)*(box.right-box.left);
  const maximum=Math.max(...points.map(p=>p.efficiency));
  const magnitude=10**Math.floor(Math.log10(maximum));
  const ceiling=Math.ceil(maximum/magnitude)*magnitude;
  const y=e=>box.bottom-e/(ceiling*1.12)*(box.bottom-box.top);
  for(const value of [0,ceiling/4,ceiling/2,ceiling*3/4,ceiling]){
    svg.append(svgElement('line',{x1:box.left,x2:box.right,y1:y(value),y2:y(value),class:'grid'}));
    svg.append(svgElement('text',{x:box.left-9,y:y(value)+4,'text-anchor':'end'},number(value)));
  }
  const tickCount=width<420?2:4;
  for(let i=0;i<=tickCount;i++){
    const f=low+(high-low)*i/tickCount;
    svg.append(svgElement('line',{x1:x(f),x2:x(f),y1:box.top,y2:box.bottom,class:'grid'}));
    svg.append(svgElement('text',{x:x(f),y:box.bottom+22,'text-anchor':i===0?'start':i===tickCount?'end':'middle'},rate(f)));
  }
  svg.append(svgElement('rect',{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,class:'frame'}));
  svg.append(svgElement('text',{x:box.left,y:14},copy.cumulativeYAxis));
  svg.append(svgElement('text',{x:(box.left+box.right)/2,y:height-8,'text-anchor':'middle'},copy.cumulativeXAxis));
  svg.append(svgElement('path',{d:points.map((p,i)=>`${i?'L':'M'}${x(p.feeRate).toFixed(2)},${y(p.efficiency).toFixed(2)}`).join(' '),class:'cumulative-guide'}));
  for(const p of points){
    const dot=svgElement('circle',{cx:x(p.feeRate),cy:y(p.efficiency),r:2,class:'candidate-dot'});
    dot.append(svgElement('title',{},copy.cumulativePoint(rate(p.feeRate),number(p.gain),rate(p.extraFee),number(p.efficiency))));
    svg.append(dot);
  }
  const peak=cumulative.peak,cx=x(peak.feeRate),cy=y(peak.efficiency);
  svg.append(svgElement('line',{x1:cx,x2:cx,y1:box.top,y2:box.bottom,class:'target'}));
  const ring=svgElement('circle',{cx,cy,r:9,class:'cumulative-point'});
  ring.append(svgElement('title',{},copy.cumulativePoint(rate(peak.feeRate),number(peak.gain),rate(peak.extraFee),number(peak.efficiency))));
  svg.append(ring);
  const old=recommendation?.recommended;
  if(old && old.ticks>base.ticks){
    const oldAverage=(old.priority-base.priority)/((old.ticks-base.ticks)/100);
    const ox=x(old.feeRate),oy=y(oldAverage);
    const star=svgElement('path',{d:Array.from({length:10},(_,i)=>{
      const angle=-Math.PI/2+i*Math.PI/5,r=i%2?3:7;
      return `${i?'L':'M'}${ox+Math.cos(angle)*r},${oy+Math.sin(angle)*r}`;
    }).join(' ')+' Z',class:'window-average-point'});
    star.append(svgElement('title',{},copy.marker(copy.recommended,rate(old.feeRate),number(old.priority))));svg.append(star);
  }
  text('cumulative-caption',copy.cumulativeCaption(rate(base.feeRate)));
}

function render() {
  text('target-value', target+'%');
  const windowTicks = Number(byId('marginal-step').value);
  minimum=minimumForPriority(distribution,target);
  recommendation=recommendRate(distribution,{ minimumPriority:target,stepTicks:windowTicks });
  cumulative=recommendCumulative(distribution,{ minimumPriority:target });
  marginal=recommendation?.marginal || null;
  updateStatus();
  const rows=byId('requirement-rows'); rows.replaceChildren();
  if (minimum) {
    for (const requirement of [...new Set([50,60,80,95,target])].sort((a,b)=>a-b)) {
      const point=minimumForPriority(distribution,requirement);
      const row=document.createElement('tr'); if(requirement===target)row.className='selected';
      for (const value of [requirement+'%',rate(point.feeRate)+' '+copy.rateUnit,number(point.priority)+'%']) { const cell=document.createElement('td');cell.textContent=value;row.append(cell); }
      rows.append(row);
    }
  }
  const peak=marginal?.peak;
  text('marginal-caption',peak?copy.marginalCaption(rate(peak.start.feeRate),rate(peak.end.feeRate),number(peak.gain)):marginal?copy.marginalNone:copy.pending);
  drawChart();
  drawMarginalChart();
  drawCumulativeChart();
}
new ResizeObserver(()=>{drawChart();drawMarginalChart();drawCumulativeChart();}).observe(byId('chart-host'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-observedAt>45000)requestFull();});
window.addEventListener('beforeunload',()=>{clearTimeout(reconnect);socket?.close();});
render(); connect();
