const fs = require('fs');
const src = fs.readFileSync('E:/Desktop/geoguesser/MmaGuessr.html','utf8');
const m = src.indexOf('const LOCATIONS =');
const o = src.indexOf('[',m);
let d=0,is=false,q='',esc=false,e=-1;
for(let i=o;i<src.length;i++){
  const c=src[i];
  if(esc){esc=false;continue}
  if(c==='\\'){esc=true;continue}
  if(c==='"'||c==="'"|| c==='`'){if(!is){is=true;q=c}else if(q===c){is=false;q=''};continue}
  if(is)continue
  if(c==='[')d++;else if(c===']'){d--;if(d===0){e=i;break}}
}
const arr = eval(src.slice(o,e+1));
const cn = arr.filter(l => l.name.startsWith('中国'));
const regionMap = {}, diffMap = {};
arr.forEach(l => {
  regionMap[l.region] = (regionMap[l.region]||0)+1;
  diffMap[l.difficulty] = (diffMap[l.difficulty]||0)+1;
});
console.log('TOTAL:', arr.length);
console.log('CHINA:', cn.length);
console.log('REGIONS:', JSON.stringify(regionMap));
console.log('DIFF:', JSON.stringify(diffMap));
