const fs=require('node:fs');
const cheerio=require('../backend/node_modules/cheerio');
for(const file of ['test-results/web-probe/operator.html','test-results/web-probe/legal-3','test-results/web-probe/gov.txt']){
 if(!fs.existsSync(file))continue;
 const doc=cheerio.load(fs.readFileSync(file));
 console.log(file);
 console.log(JSON.stringify(doc('a[href]').toArray().map(a=>({text:doc(a).text().trim(),url:doc(a).attr('href')})).filter(a=>/pdf|docx|zan\.kz|download|\.gov\.kz\/uploads/.test(a.url||'')),null,2));
 console.log('content roots: '+JSON.stringify(doc('h1').toArray().map(a=>{let el=doc(a);const parents=[];for(let i=0;i<4;i++){parents.push({tag:el.prop('tagName'),class:el.attr('class'),length:el.text().length});el=el.parent();}return parents;})));
}
