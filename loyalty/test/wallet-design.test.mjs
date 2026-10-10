import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { stripPng, stripKey, renderKey, parseKey, STRIP_VERSION } from '../src/strip.js';
import { renderKey as classicRender } from '../src/strip-classic.js';
import { renderKey as haloRender } from '../src/strip-halo.js';
import { runScheduled } from '../src/app.js';
import { setup, signup, fakeGoogle, rsaKey } from './helpers.mjs';

function pixels(png) {
  const buf=Buffer.from(png), blocks=[];
  for(let off=8;off<buf.length;) {
    const len=buf.readUInt32BE(off), type=buf.toString('ascii',off+4,off+8);
    if(type==='IDAT') blocks.push(buf.subarray(off+8,off+8+len));
    off+=12+len;
  }
  const w=buf.readUInt32BE(16), h=buf.readUInt32BE(20), raw=inflateSync(Buffer.concat(blocks));
  return {w,h,pixel(x,y){ const off=Math.floor(y)* (w*3+1)+1+Math.floor(x)*3;return [...raw.subarray(off,off+3)]; }};
}

test('الحلقة بتعرض الرصيد الفعلي وبتضل واضحة بالألوان الفاتحة والغامقة',async()=>{
  assert.equal(STRIP_VERSION,5);
  for(const color of ['#2f5d50','#ffffff','#101010','#fdcb33']) {
    const bg=color.slice(1).match(/../g).map(v=>parseInt(v,16));
    for(const balance of [0,4,9,10]) {
      const img=pixels(await renderKey(`s3|${color}|cup|10|${balance}|${balance===10?1:0}`));
      assert.deepEqual([img.w,img.h],[1125,432]);
      assert.deepEqual(img.pixel(0,0),bg,'الحواف نفس لون صاحب المحل');
      let filled=0;
      for(let n=0;n<10;n++) {
        const a=-Math.PI/2+(n+0.5)*2*Math.PI/10;
        const px=img.pixel((99.375+46.8*Math.cos(a))*3,(72+46.8*Math.sin(a))*3);
        const delta=Math.max(...px.map((v,i)=>Math.abs(v-bg[i])));
        if(delta>100)filled++;
      }
      assert.equal(filled,balance,`${color}: ${balance} أجزاء مضيئة`);
    }
  }
});

test('الروابط القديمة بتضل نفسها، والحالات المستحيلة ما بتنرسم',async()=>{
  const old='g2|#2f5d50|cup|10|4|0';
  assert.deepEqual(await renderKey(old),await classicRender(old));
  assert.deepEqual(await renderKey('g3|#2f5d50|cup|10|4|0'),await haloRender('g3|#2f5d50|cup|10|4|0'));
  for(const key of ['g3|#2f5d50|cup|10|10|0','g3|#2f5d50|cup|10|4|1','g3|#2f5d50|cup|0|0|0','g3|#2f5d50|missing|10|4|0']) assert.equal(parseKey(key),null);
  for(const icon of ['cupcake','scissors','dish','bag','star']) {
    const img=pixels(await renderKey(`g3|#ffffff|${icon}|8|3|0`));
    assert.deepEqual([img.w,img.h],[1032,336]);
  }
});

test('تحديث المحافظ على دفعات، بيعيد الفشل وبيحافظ على كل بيانات الزبون',async()=>{
  let fail=true;
  const google=fakeGoogle({'PATCH /loyaltyObject/':()=>({status:fail?500:200})});
  const {db,env,client}=await setup({PUBLIC_URL:'https://loyalty.test',GOOGLE_ISSUER_ID:'3388',GOOGLE_SERVICE_ACCOUNT:JSON.stringify({client_email:'halo-test@proj.iam.gserviceaccount.com',private_key:rsaKey().pem}),fetch:google.fetch});
  const admin=client();const {shop}=await signup(admin);
  for(let n=0;n<7;n++) {
    const join=await client().post(`/api/shops/${shop.slug}/join`,{name:`customer ${n}`,phone:`079100000${n}`});
    assert.equal(join.status,201);
  }
  await db.run('UPDATE members SET gw_object=1');
  const before=await db.all('SELECT * FROM members ORDER BY id');
  const cron=()=>runScheduled({db,env,waitUntil:p=>p},Date.now());
  const started=Date.now();
  assert.equal((await cron()).walletDesign,'retry');
  assert.ok(JSON.parse((await db.get("SELECT v FROM platform_settings WHERE k='wallet_design_rollout'")).v).at >= started,'وقت التفعيل بيضمن تحديث البطاقات اللي نزلت قبل النشر');
  assert.equal(JSON.parse((await db.get("SELECT v FROM platform_settings WHERE k='wallet_design_rollout'")).v).cursor,0);
  fail=false;
  for(const expected of [3,3,1]) assert.equal((await cron()).walletDesign,expected);
  assert.equal((await cron()).walletDesign,'done');
  assert.deepEqual(await db.all('SELECT * FROM members ORDER BY id'),before,'النقاط والهويات والتواريخ ما تغيّرت');
  const calls=google.calls.filter(c=>c.method==='PATCH'&&c.url.includes('/loyaltyObject/'));
  const classes=google.calls.filter(c=>c.method==='PATCH'&&c.url.includes('/loyaltyClass/'));
  assert.equal(classes.length,1,'قالب المحل بيتحدّث مرة واحدة، حتى بعد إعادة محاولة تحديث الزبائن');
  assert.deepEqual(Object.keys(classes[0].body).sort(),['accountIdLabel','accountNameLabel','classTemplateInfo']);
  assert.equal(calls.length,8,'محاولة فاشلة وسبع ناجحة، بدون تكرار الناجح');
  for(const call of calls) {
    assert.match(call.body.heroImage.sourceUri.uri,/\/g5-/);
    assert.deepEqual(Object.keys(call.body).sort(),['heroImage','id'],'التحديث ما بيلمَس حقول النقاط والـ QR');
  }
});


test('التصميم الهندسي: النسبة الدقيقة والأختام ولون المحل، بدون بيانات شخصية برابط عام',async()=>{
  for(const color of ['#205447','#ffffff','#101010','#fdcb33']) {
    const bg=color.slice(1).match(/../g).map(v=>parseInt(v,16));
    for(const balance of [0,4,9,10]) {
      const shop={color,program_type:'points',reward_threshold:10,reward_name:'قهوة'};
      const img=pixels(await stripPng(shop,balance));
      assert.deepEqual([img.w,img.h],[1125,432]);
      assert.deepEqual(img.pixel(0,0),bg);
      let filled=0;
      for(let n=0;n<10;n++) {
        const px=img.pixel((24+n*(375*.65-24)/9)*3,144*.88*3);
        if(Math.max(...px.map((v,i)=>Math.abs(v-bg[i])))>100)filled++;
      }
      assert.equal(filled,balance);
      assert.equal(parseKey(stripKey(shop,balance)).percent,balance*10);
    }
  }
  const shop={color:'#205447',reward_threshold:1000,name:'private shop'};
  assert.match(stripKey(shop,459),/\|10\|4\|0\|45$/,'النسبة مش مقربة لعشرات');
  assert.match(stripKey(shop,999),/\|99$/,'ما بنحكي 100% قبل استحقاق المكافأة');
  assert.match(stripKey(shop,1000),/\|10\|10\|1\|100$/);
  const key=stripKey({...shop,name:'another shop'},459);
  assert.equal(key,stripKey(shop,459),'بيانات الأسماء وأرقام العضوية ما بتظهر بروابط الصورة العامة');
  for(const k of ['g4|#205447|cup|10|4|0','g4|#205447|cup|10|4|0|100','g4|#205447|cup|10|10|1|99','g3|#205447|cup|10|4|0|40'])assert.equal(parseKey(k),null);
  for(const slots of [1,8,12]) {
    const img=pixels(await stripPng({color:'#205447',program_type:'stamps',stamps_required:slots},0,'g'));
    assert.deepEqual([img.w,img.h],[1032,336]);
  }
});

test('v5: النقاط بتتعبّى من اليمين والشريط بنفس لون البطاقة، وv4 ما تغيّرت',async()=>{
  const dots=async(key)=>{
    const img=pixels(await renderKey(key));
    const bg=key.split('|')[1].slice(1).match(/../g).map(v=>parseInt(v,16));
    const spacing=(375*.65-24)/9;
    const lit=[];
    for(let n=0;n<10;n++){ const px=img.pixel((24+n*spacing)*3,144*.88*3); lit.push(Math.max(...px.map((v,i)=>Math.abs(v-bg[i])))>100); }
    return {img,bg,lit};
  };
  const v5=await dots('s5|#2f5d50|cup|10|3|0|30');
  assert.deepEqual(v5.lit,[false,false,false,false,false,false,false,true,true,true],'3 نقاط من اليمين');
  assert.deepEqual(v5.img.pixel(1120,5),v5.bg,'طرف الشريط اليمين بنفس لون البطاقة (ما في صندوق)');
  assert.deepEqual(v5.img.pixel(1120,425),v5.bg);
  const v4=await dots('s4|#2f5d50|cup|10|3|0|30');
  assert.deepEqual(v4.lit,[true,true,true,false,false,false,false,false,false,false],'روابط v4 القديمة بترجع نفس الصورة');
  assert.notDeepEqual(v4.img.pixel(1120,5),v4.bg);
});
