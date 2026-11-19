#!/usr/bin/env python3
"""Idempotent pilot seed: a realistic Studio service ("New Trade Licence") with statutory
references, form fields and required documents, submitted for approval.
REST via the gateway only, as the uxtester maker persona (token via Keycloak password grant).
Publishing needs a DIFFERENT authorised checker (maker-checker), so it is not done here."""
import json,os,sys,time,urllib.request,urllib.parse,urllib.error
K='http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token'; GW='http://localhost:8080'
KEY='new-trade-licence-municipal'; NAME='New Trade Licence'
PW={}
for l in open(os.path.expanduser('~/orch-logs/uat-demo-passwords.txt')):
    p=l.split()
    if len(p)==2 and not l.startswith('#'): PW[p[0]]=p[1]
PW.setdefault('uxtester','UxTester@2026')
d=urllib.parse.urlencode({'client_id':'civitasone-web','username':'uxtester','password':PW['uxtester'],'grant_type':'password'}).encode()
TOK=json.load(urllib.request.urlopen(K,d,timeout=20))['access_token']
def call(m,path,body=None):
    for a in range(5):
        time.sleep(0.35)
        req=urllib.request.Request(GW+path,method=m,headers={'authorization':'Bearer '+TOK,'content-type':'application/json','accept':'application/json'},data=None if body is None else json.dumps(body).encode())
        try:
            r=urllib.request.urlopen(req,timeout=30); b=r.read(); return r.status,(json.loads(b) if b else None)
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(2*(a+1)); continue
            b=e.read().decode()[:500]
            try: b=json.loads(b)
            except Exception: pass
            return e.code,b
    return 429,None
def rows(j): return j if isinstance(j,list) else (j or {}).get('data',(j or {}).get('items',[]))
def wait(fn,tries=20):
    for _ in range(tries):
        v=fn()
        if v: return v
        time.sleep(1)
    raise SystemExit('timeout waiting')
CAT='/api/v1/citizen/catalogue/services'
def find():
    s,j=call('GET',CAT+'?limit=200'); return [r for r in rows(j) if r['serviceKey']==KEY]
cur=find()
if not cur:
    print('create',call('POST',CAT,{'serviceKey':KEY,'name':NAME,'servicePattern':'certificate','ownerDepartment':'Municipal Health & Licensing Department','channels':['portal','counter']}))
    cur=wait(find)
d=cur[0]; sid=d['id']; print('service',sid,d['status'])
if d['status']=='draft' and (d.get('hoaCode') is None or not d.get('statutoryReferences')):
    refs=[{'act':'Delhi Municipal Corporation Act, 1957','section':'Section 417 - Licence for factory, workshop or trade','url':'https://indiacode.nic.in/'},
          {'act':'Delhi Municipal Corporation Act, 1957','section':'Section 421 - Fee for licence and its renewal'},
          {'act':'Food Safety and Standards Act, 2006','section':'Section 31 - Licensing and registration of food businesses'},
          {'act':'Goods and Services Tax Act, 2017','section':'Section 22 - Persons liable for registration'}]
    print('patch',call('PATCH',f'{CAT}/{sid}',{'statutoryReferences':refs,'slaDays':21,'feeModel':'flat','hoaCode':'0217','issuanceType':'certificate',
      'requiredDocuments':[{'label':'Proof of premises ownership or rent agreement','docType':'premises_proof','formats':['pdf'],'mandatory':True},
                           {'label':'PAN card','docType':'pan','formats':['pdf','jpg'],'mandatory':True},
                           {'label':'Identity proof (Aadhaar)','docType':'aadhaar','formats':['pdf'],'mandatory':True}]}))
    wait(lambda: len(call('GET',f'{CAT}/{sid}')[1].get('statutoryReferences') or [])==4 and call('GET',f'{CAT}/{sid}')[1].get('hoaCode')=='0217')
# ---- form: metadata entity/fields/layout/version, same shape the Studio b2 page reads
ent='designer_svc_'+KEY.replace('-','_')
e=[x for x in rows(call('GET','/api/v1/metadata/entities')[1]) if x['apiName']==ent]
if not e:
    print('entity',call('POST','/api/v1/metadata/entities',{'apiName':ent,'label':NAME+' - Application','pluralLabel':NAME+' Applications'}))
    e=wait(lambda:[x for x in rows(call('GET','/api/v1/metadata/entities')[1]) if x['apiName']==ent])
eid=e[0]['id']
FIELDS=[('applicant_name','Applicant full name','text',True,None),
        ('trade_type','Type of trade','picklist',True,['Grocery / General store','Restaurant / Eatery','Garment shop','Workshop / Light manufacturing','Medical store','Other']),
        ('premises_address','Premises address','text',True,None),
        ('ward','Ward number','text',True,None),
        ('pan_number','PAN of proprietor','text',True,None),
        ('gstin','GSTIN (if registered)','text',False,None),
        ('commencement_date','Proposed date of commencement','date',True,None)]
have={f['apiName'] for f in rows(call('GET',f'/api/v1/metadata/entities/{eid}/fields')[1])}
for i,(a,l,t,r,pv) in enumerate(FIELDS,1):
    if a in have: continue
    b={'apiName':a,'label':l,'fieldType':t,'isRequired':r,'sortOrder':i}
    if pv: b['picklistValues']=pv
    print('field',a,call('POST',f'/api/v1/metadata/entities/{eid}/fields',b)[0])
wait(lambda: len(rows(call('GET',f'/api/v1/metadata/entities/{eid}/fields')[1]))>=len(FIELDS))
secs=[{'label':'Applicant & trade details','columns':1,'fields':['applicant_name','trade_type','pan_number','gstin','commencement_date']},
      {'label':'Premises','columns':1,'fields':['premises_address','ward']}]
lay=rows(call('GET',f'/api/v1/metadata/entities/{eid}/layouts')[1])
if not lay:
    print('layout',call('POST',f'/api/v1/metadata/entities/{eid}/layouts',{'layoutType':'edit','sections':secs,'isDefault':True})[0])
    lay=wait(lambda: rows(call('GET',f'/api/v1/metadata/entities/{eid}/layouts')[1]))
lid=lay[0]['id']
if not rows(call('GET',f'/api/v1/metadata/forms/{lid}/versions?limit=10')[1]):
    print('formversion',call('POST',f'/api/v1/metadata/forms/{lid}/versions',{'visibilityRules':[],'cascadeRules':[]})[0])
    wait(lambda: rows(call('GET',f'/api/v1/metadata/forms/{lid}/versions?limit=10')[1]))

# ---- form design stored on the definition (forms[0].formDesign) - what the Studio review page / a11y preview read
def form_design():
    spec=[('ntl-sec-applicant','Applicant & trade details',[
            ('applicant_name','profile_name','Applicant full name',True,None),
            ('trade_type','picklist_single','Type of trade',True,['Grocery / General store','Restaurant / Eatery','Garment shop','Workshop / Light manufacturing','Medical store','Other']),
            ('pan_number','text','PAN of proprietor',True,None),
            ('gstin','text','GSTIN (if registered)',False,None),
            ('commencement_date','date','Proposed date of commencement',True,None)]),
          ('ntl-sec-premises','Premises',[
            ('premises_address','address','Premises address',True,None),
            ('ward','ward','Ward',True,None)])]
    secs=[]; fields={}; n=0
    for sid,label,fl in spec:
        ids=[]
        for api,t,lab,req,ch in fl:
            n+=1; fid=f'ntl-f{n}'; ids.append(fid)
            f={'id':fid,'type':t,'label':lab,'apiName':api,'required':req,'sectionId':sid}
            if ch: f['choices']=ch
            fields[fid]=f
        secs.append({'id':sid,'label':label,'fieldIds':ids})
    return {'sections':secs,'fields':fields}
d=call('GET',f'{CAT}/{sid}')[1]
if d['status']=='draft' and not d.get('forms'):
    print('forms',call('PATCH',f'{CAT}/{sid}',{'forms':[{'formDesign':form_design(),'runtimeMeta':{'description':'Apply for a new municipal trade licence. Keep your premises proof, PAN and Aadhaar ready to upload.','feeCurrency':'INR'}}]}))
    wait(lambda: call('GET',f'{CAT}/{sid}')[1].get('forms'))
d=call('GET',f'{CAT}/{sid}')[1]
if d['status']=='draft' and not d.get('submittedBy'):
    print('submit (best effort; gated on a passing sandbox test: needs eligibility, workflow, fee schedule, doc lanes)',call('POST',f'{CAT}/{sid}/submit',{})[0])
d=call('GET',f'{CAT}/{sid}')[1]
print('STATE',sid,d['status'],'submittedBy',d.get('submittedBy'),'refs',len(d.get('statutoryReferences') or []))
print('lookup',call('GET',f'/api/v1/citizen/catalogue/published/lookup?serviceKey={KEY}')[0])
print('a11y',call('GET',f'{CAT}/{sid}/a11y-preview')[1])
