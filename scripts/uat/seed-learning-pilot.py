#!/usr/bin/env python3
"""API-only, idempotent pilot seed for the learning module (tenant 11111111-...-0001).
Creates realistic municipal L&D courses/modules/lessons, a training plan with items,
and enrols the uxtester persona. Auth: Keycloak password grant; persona uxtester, password via UXT_PASSWORD env."""
import os,json,time,urllib.request,urllib.parse,urllib.error,sys
K="http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token"; GW="http://localhost:8080/api/v1"
def tok():
    d=urllib.parse.urlencode({"client_id":"civitasone-web","username":"uxtester","password":os.environ["UXT_PASSWORD"],"grant_type":"password"}).encode()
    return json.load(urllib.request.urlopen(K,d))["access_token"]
T=tok()
def call(m,p,body=None):
    for a in range(4):
        time.sleep(0.35)
        r=urllib.request.Request(GW+p,method=m,headers={"authorization":"Bearer "+T,"content-type":"application/json"},data=json.dumps(body).encode() if body is not None else None)
        try:
            x=urllib.request.urlopen(r,timeout=30); b=x.read(); return x.status,(json.loads(b) if b else None)
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(3+a*3); continue
            b=e.read()
            try: return e.code,json.loads(b)
            except Exception: return e.code,b[:300]
def wait(fn,tries=20):
    for _ in range(tries):
        v=fn()
        if v: return v
        time.sleep(1)
CATALOGUE=[
 ("RTI-101","RTI Act Essentials","compliance",6,[
   ("Overview of the RTI Act, 2005",[("Right to information: scope and exemptions","pdf",45),("Role of PIO and First Appellate Authority","video",30)]),
   ("Handling applications",[("Time limits, fees and transfer under Section 6(3)","pdf",40),("Drafting a reply and rejection under Section 8","link",35)])]),
 ("ACC-201","Municipal Accounting (double-entry)","finance",12,[
   ("Foundations of accrual accounting",[("From cash to accrual: NMAM overview","video",50),("Chart of accounts for ULBs","pdf",40)]),
   ("Journal and ledger practice",[("Recording receipts and property tax demand","video",60),("Bank reconciliation and year-end closing","pdf",55)])]),
 ("GRV-110","Public Grievance Redressal","service-delivery",4,[
   ("Grievance lifecycle",[("Registration, routing and SLA tracking (CPGRAMS)","video",30),("Escalation matrix and closure quality","pdf",25)])]),
 ("SAF-120","Workplace Safety","safety",3,[
   ("Field and office safety",[("Fire safety and evacuation drill","video",25),("Sanitation worker PPE and confined-space rules","pdf",35)])]),
]
cs,courses=call("GET","/hrms/learning/courses"); assert cs==200,courses
by_code={c["code"]:c for c in courses}
ids={}
for code,title,cat,hrs,mods in CATALOGUE:
    if code in by_code: cid=by_code[code]["id"]; print("exists",code)
    else:
        s,b=call("POST","/hrms/learning/courses",{"code":code,"title":title,"description":title+" - mandatory/recommended training for municipal staff.","category":cat,"creditHours":hrs}); assert s==201,(s,b)
        cid=b["id"]; print("created",code)
    ids[code]=cid
    c=wait(lambda: call("GET","/hrms/learning/courses/"+cid)[1] if call("GET","/hrms/learning/courses/"+cid)[0]==200 else None)
    det=c
    have_mods=det.get("modules") or []
    if not have_mods:
        for mi,(mt,lessons) in enumerate(mods,1):
            s,m=call("POST",f"/hrms/learning/courses/{cid}/modules",{"title":mt,"sequence":mi}); assert s==201,(s,m)
            time.sleep(1.5)
            for li,(lt,ct,dur) in enumerate(lessons,1):
                s,l=call("POST",f"/hrms/learning/modules/{m['id']}/lessons",{"title":lt,"sequence":li,"contentType":ct,"contentUri":"https://elearn.example.gov.in/"+code.lower()+f"/m{mi}l{li}","durationMins":dur}); assert s==201,(s,l)
    if (det.get("status") or "")!="published":
        s,b=call("POST",f"/hrms/learning/courses/{cid}/publish",{}); print("publish",code,s)
json.dump(ids,open("course_ids.json","w"))
# training plan
PT="FY 2026-27 Mandatory Compliance Training Plan"
s,pl=call("GET","/hrms/learning/training-plans?limit=200"); plans={p["title"]:p for p in pl["data"]}
if PT in plans: pid=plans[PT]["id"]; print("plan exists")
else:
    s,b=call("POST","/hrms/learning/training-plans",{"title":PT,"planYear":2026}); assert s in(200,201,202),(s,b); pid=b["id"]
wait(lambda: call("GET","/hrms/learning/training-plans/"+pid)[0]==200)
s,pd=call("GET","/hrms/learning/training-plans/"+pid)
if not pd.get("items"):
    for code,td,mand in [("RTI-101","2026-12-15",True),("GRV-110","2027-01-31",True),("SAF-120","2027-02-28",True),("ACC-201","2027-03-15",False)]:
        s,b=call("POST",f"/hrms/learning/training-plans/{pid}/items",{"courseId":ids[code],"targetDate":td,"mandatory":mand}); assert s in(200,201,202),(s,b)
        time.sleep(1)
# enrolment (self)
s,prof=call("GET","/hrms/me/profile"); emp=prof["id"]
for code in ["RTI-101","SAF-120"]:
    s,b=call("POST",f"/hrms/learning/courses/{ids[code]}/enroll",{"employeeId":emp}); print("enroll",code,s,b)
    time.sleep(1)
json.dump({"plan":pid,"courses":ids,"employee":emp},open("seed_result.json","w"))
print(json.dumps({"plan":pid,"courses":ids}))
