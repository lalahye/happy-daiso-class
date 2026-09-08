import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from 'firebase/auth';
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, runTransaction, deleteDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Tesseract from 'tesseract.js';

GlobalWorkerOptions.workerSrc = pdfWorker;

const MENU = [
  ['home','⌂','홈'],
  ['praise','♡','칭찬함'],
  ['voice','♧','불편의 소리'],
  ['study','▣','학습방'],
  ['quiz','?','퀴즈방'],
  ['gallery','▧','작품전시관'],
  ['record','✎','나의 기록'],
  ['vote','▥','우리 반 투표'],
  ['coupon','▤','쿠폰 구매'],
];

const COUPONS = [
  ['🥇','점심 1등',30],['🍪','간식 1개',30],['🎵','신청곡 3개',40],
  ['☀️','아침 자유 활동권',40],['🔄','1인1역 3일 교환',50],
  ['🎬','게임/영화 선택권',50],['💺','자리 바꾸기 5일권',60],
];

const QUIZ = [
  { subject:'국어', q:'글쓴이가 글에서 가장 중요하게 말하고자 하는 생각은?', options:['중심 생각','문단 번호','글자 수','삽화'], answer:'중심 생각' },
  { subject:'사회', q:'지도에서 실제 거리를 일정한 비율로 줄여 나타낸 정도는?', options:['축척','방위','범례','기호'], answer:'축척' },
  { subject:'과학', q:'식물이 잘 자라기 위해 필요한 조건이 아닌 것은?', options:['물','빛','알맞은 온도','플라스틱 조각'], answer:'플라스틱 조각' },
  { subject:'수학', q:'48,000에서 1,000을 6번 빼면 얼마일까요?', options:['42,000','43,000','46,000','54,000'], answer:'42,000' },
  { subject:'수학', q:'어떤 수에 2,500을 더했더니 10,000입니다. 그 수에서 1,750을 빼면?', options:['5,750','6,250','7,500','8,250'], answer:'5,750' },
];

const MISSION_LIST = [
  '친구 한 명의 좋은 점을 직접 말해주기',
  '혼자 있는 친구에게 먼저 말을 걸어보기',
  '도움을 받은 친구에게 고맙다고 말하기',
  '친구 이야기를 끊지 않고 끝까지 들어주기',
  '친구가 실수했을 때 괜찮다고 말해주기'
];

export default function App(){
  const [user,setUser]=useState(null);
  const [profile,setProfile]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>onAuthStateChanged(auth, async u=>{
    setUser(u);
    if(!u){
      setProfile(null);
      setLoading(false);
      return;
    }

    try{
      const userRef=doc(db,'users',u.uid);
      const snap=await getDoc(userRef);

      if(!snap.exists()){
        const newProfile={
          name:u.displayName||'학생',
          email:u.email||'',
          photoURL:u.photoURL||'',
          role:'student',
          points:0,
          createdAt:serverTimestamp()
        };
        await setDoc(userRef,newProfile);
        setProfile({...newProfile,createdAt:null});
      }else{
        setProfile(snap.data());
      }
    }catch(err){
      console.error(err);
      setProfile(null);
    }finally{
      setLoading(false);
    }
  }),[]);

  if(loading) return <div className="page-center"><div className="loader-card">행복한 다이소반을 불러오는 중...</div></div>;
  if(!user) return <Login/>;
  if(!profile) return <div className="page-center"><div className="loader-card">사용자 정보를 불러오지 못했습니다. Firebase 설정을 확인해주세요.</div></div>;
  return profile.role==='teacher'?<TeacherApp profile={profile}/>:<StudentApp profile={profile}/>;
}

function Login(){
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  const googleLogin=async()=>{
    setError('');
    setBusy(true);
    try{
      const provider=new GoogleAuthProvider();
      provider.setCustomParameters({prompt:'select_account'});
      await signInWithPopup(auth,provider);
    }catch(err){
      console.error(err);
      if(err?.code==='auth/popup-closed-by-user') setError('Google 로그인 창이 닫혔어요. 다시 시도해주세요.');
      else if(err?.code==='auth/popup-blocked') setError('브라우저에서 팝업이 차단되었습니다. 팝업을 허용해주세요.');
      else if(err?.code==='auth/unauthorized-domain') setError('현재 접속 주소가 Firebase 승인 도메인에 등록되어 있지 않습니다.');
      else setError('Google 로그인에 실패했습니다. Firebase Authentication 설정을 확인해주세요.');
    }finally{
      setBusy(false);
    }
  };

  return <div className="login-page">
    <div className="login-card">
      <div className="brand-mark">🌱</div>
      <h1>행복한 다이소반</h1>
      <p>함께 배려하고, 함께 성장하는 교실</p>
      <button type="button" className="google-login-btn" onClick={googleLogin} disabled={busy}>
        <span className="google-g">G</span>
        {busy?'Google 로그인 중...':'Google 계정으로 로그인'}
      </button>
      <div className="login-help">학생은 자신의 학교 Google 계정으로 로그인하세요.</div>
      {error&&<div className="error-box">{error}</div>}
    </div>
  </div>;
}

function StudentApp({profile}){
  const [page,setPage]=useState('home');
  const [points,setPoints]=useState(profile.points??0);
  const [missionDone,setMissionDone]=useState(false);
  const mission=MISSION_LIST[new Date().getDate()%MISSION_LIST.length];
  const classPoint=useClassPointData();

  const addPoints=async (n,reason='포인트 적립')=>{
    const next=points+n;setPoints(next);
    await updateDoc(doc(db,'users',auth.currentUser.uid),{points:next});
    await addDoc(collection(db,'pointTransactions'),{uid:auth.currentUser.uid,amount:n,reason,balanceAfter:next,createdAt:serverTimestamp()});
  };
  const spendPoints=async (n,reason='포인트 사용')=>{
    if(points<n)return false;
    const next=points-n;setPoints(next);
    await updateDoc(doc(db,'users',auth.currentUser.uid),{points:next});
    await addDoc(collection(db,'pointTransactions'),{uid:auth.currentUser.uid,amount:-n,reason,balanceAfter:next,createdAt:serverTimestamp()});
    return true;
  };

  useEffect(()=>{
    const today=new Date().toISOString().slice(0,10);
    getDoc(doc(db,'missionCompletions',`${auth.currentUser.uid}_${today}`)).then(s=>setMissionDone(s.exists()));
  },[]);

  const finishMission=async()=>{
    if(missionDone)return;
    if(!window.confirm('정말로 미션을 수행하고, 버튼을 눌렀나요?'))return;
    const today=new Date().toISOString().slice(0,10);
    await setDoc(doc(db,'missionCompletions',`${auth.currentUser.uid}_${today}`),{
      uid:auth.currentUser.uid,date:today,mission,createdAt:serverTimestamp()
    });
    await addPoints(1,'오늘의 미션 완료');setMissionDone(true);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">🌱</div><div><strong>행복한 다이소반</strong><span>4학년 1반</span></div></div>
      <nav>{MENU.map(([key,icon,label])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}>
        <span className="nav-icon">{icon}</span><span>{label}</span>
      </button>)}</nav>
      <div className="profile-card">
        <div className="avatar">🧒</div><div><strong>{profile.name||'학생'}</strong><button onClick={()=>signOut(auth)}>로그아웃</button></div>
      </div>
    </aside>

    <main className="main-panel">
      <header className="mobile-head"><div className="brand-icon">🌱</div><strong>행복한 다이소반</strong><button onClick={()=>signOut(auth)}>로그아웃</button></header>
      {page==='home'&&<Home profile={profile} points={points} mission={mission} missionDone={missionDone} finishMission={finishMission} go={setPage} classPoint={classPoint}/>}
      {page==='points'&&<PointHistory points={points}/>}
      {page==='classpoints'&&<ClassPoints points={points} setPoints={setPoints} classPoint={classPoint}/>}
      {page==='notifications'&&<Notifications go={setPage}/>}
      {page==='praise'&&<Praise/>}
      {page==='voice'&&<Voice/>}
      {page==='study'&&<Study/>}
      {page==='quiz'&&<Quiz onPerfect={()=>addPoints(3,'퀴즈 5문제 모두 정답')}/>}
      {page==='gallery'&&<Gallery onReward={()=>addPoints(2,'작품전시관 작품 등록')} points={points}/>}
      {page==='record'&&<Record/>}
      {page==='vote'&&<Vote points={points}/>}
      {page==='coupon'&&<Coupon points={points} spend={spendPoints}/>}
    </main>
    <nav className="bottom-nav">
      {MENU.slice(0,5).map(([key,icon,label])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}><span>{icon}</span><small>{label}</small></button>)}
    </nav>
  </div>;
}

function Home({profile,points,mission,missionDone,finishMission,go,classPoint}){
  const goal=classPoint.goal||3000;
  const total=classPoint.total||0;
  const pct=Math.min(100,Math.round((total/goal)*100));
  const rewardText=classPoint.rewardSelected
    ? `🎁 이번 목표 보상 · ${classPoint.rewardSelected}`
    : classPoint.rewardVoteActive
      ? '🗳️ 이번 목표 보상 투표 진행 중'
      : '🎁 이번 목표 보상 후보를 준비 중이에요';
  return <>
    <div className="page-title"><div><h1>{profile.name||'친구'}야, 오늘도 멋진 하루 보내자! <span>☀️</span></h1><p>서로 배려하고 함께 성장하는 우리 반!</p></div><button className="notice-pill" onClick={()=>go('notifications')}>🔔 <span>알림</span><b>›</b></button></div>
    <div className="hero-grid">
      <section className="points-hero">
        <div><span className="eyebrow">⭐ 나의 포인트</span><div className="big-point">{points}<small>P</small></div><div className="point-actions"><button onClick={()=>go('points')}>포인트 내역 ›</button><button className="class-save-btn" onClick={()=>go('classpoints')}>💝 우리 반에 적립</button></div></div>
        <div className="trophy">🏆</div>
      </section>
      <section className="mission-hero">
        <div><span className="eyebrow dark">🎯 오늘의 미션</span><h2>{mission}</h2><div className="progress-line"><span>{missionDone?'1/1 완료':'0/1 완료'}</span><div><i style={{width:missionDone?'100%':'0%'}}/></div></div><button disabled={missionDone} onClick={finishMission}>{missionDone?'오늘의 미션 완료 ✓':'미션 완료하고 +1P 받기'}</button></div>
        <div className="flower">🌼</div>
      </section>
    </div>
    <button className="class-point-home" onClick={()=>go('classpoints')}>
      <div className="class-point-home-top"><div><span>🏫 우리 반 포인트</span><strong>{total.toLocaleString()} / {goal.toLocaleString()}P</strong></div><b>{pct}%</b></div>
      <div className="class-progress"><i style={{width:`${pct}%`}}/></div>
      <div className="class-reward-line"><span>{rewardText}</span><em>{Math.max(0,goal-total).toLocaleString()}P 남음 ›</em></div>
    </button>
    <h3 className="section-title">메뉴</h3>
    <div className="menu-grid">
      {[['💌','칭찬함','praise','pink'],['📮','불편의 소리','voice','rose'],['📗','학습방','study','green'],['🎮','퀴즈방','quiz','purple'],['🎨','작품전시관','gallery','orange'],['🪴','나의 기록','record','leaf'],['🗳️','우리 반 투표','vote','blue'],['🎟️','쿠폰 구매','coupon','pink']].map(([icon,label,key,tone])=><button key={key} className={`menu-card ${tone}`} onClick={()=>go(key)}><span>{icon}</span><strong>{label}</strong></button>)}
    </div>
  </>;
}

function PageHead({title,points}){return <div className="sub-head"><div><h1>{title}</h1></div>{points!==undefined&&<div className="point-chip">🏆 {points}P</div>}</div>}


function useClassPointData(){
  const [settings,setSettings]=useState({classPointGoal:3000,rewardCandidates:[],rewardVoteActive:false,rewardSelected:'',rewardRoundId:1});
  const [contributions,setContributions]=useState([]);
  useEffect(()=>{
    const stopSettings=onSnapshot(doc(db,'classSettings','main'),snap=>{
      const data=snap.exists()?snap.data():{};
      setSettings({classPointGoal:3000,rewardCandidates:[],rewardVoteActive:false,rewardSelected:'',rewardRoundId:1,...data});
    });
    return ()=>stopSettings();
  },[]);
  useEffect(()=>{
    const roundId=settings.rewardRoundId||1;
    const stop=onSnapshot(query(collection(db,'classPointContributions'),where('roundId','==',roundId)),snap=>setContributions(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return ()=>stop();
  },[settings.rewardRoundId]);
  return {
    settings,
    total:contributions.reduce((sum,x)=>sum+(Number(x.amount)||0),0),
    goal:Number(settings.classPointGoal)||3000,
    rewardCandidates:settings.rewardCandidates||[],
    rewardVoteActive:!!settings.rewardVoteActive,
    rewardSelected:settings.rewardSelected||'',
    rewardRoundId:settings.rewardRoundId||1,
    contributions
  };
}

function ClassPoints({points,setPoints,classPoint}){
  const [amount,setAmount]=useState('10');
  const [myVote,setMyVote]=useState('');
  const [busy,setBusy]=useState(false);
  const goal=classPoint.goal||3000,total=classPoint.total||0,pct=Math.min(100,Math.round(total/goal*100));
  useEffect(()=>{
    const roundId=classPoint.rewardRoundId||1;
    const stop=onSnapshot(doc(db,'classRewardVotes',`${roundId}_${auth.currentUser.uid}`),snap=>setMyVote(snap.exists()?(snap.data().choice||''):''));
    return ()=>stop();
  },[classPoint.rewardRoundId]);
  const savePoints=async()=>{
    const n=Math.floor(Number(amount));
    if(!Number.isFinite(n)||n<1)return alert('1P 이상 입력해주세요.');
    if(n>points)return alert('내 포인트가 부족해요.');
    if(!window.confirm(`${n}P를 우리 반 포인트로 적립할까요?\n적립한 포인트는 개인 포인트로 되돌릴 수 없어요.`))return;
    setBusy(true);
    try{
      const uid=auth.currentUser.uid, userRef=doc(db,'users',uid), contributionRef=doc(collection(db,'classPointContributions')), txRef=doc(collection(db,'pointTransactions'));
      let nextBalance=points-n;
      await runTransaction(db,async tx=>{
        const userSnap=await tx.get(userRef);if(!userSnap.exists())throw new Error('사용자 정보를 찾을 수 없습니다.');
        const current=Number(userSnap.data().points)||0;if(current<n)throw new Error('포인트가 부족해요.');
        nextBalance=current-n;
        tx.update(userRef,{points:nextBalance});
        tx.set(contributionRef,{uid,studentName:auth.currentUser.displayName||'학생',amount:n,roundId:classPoint.rewardRoundId||1,createdAt:serverTimestamp()});
        tx.set(txRef,{uid,amount:-n,reason:'우리 반 포인트 적립',balanceAfter:nextBalance,createdAt:serverTimestamp()});
      });
      setPoints(nextBalance);alert(`${n}P를 우리 반에 적립했어요! 🌱`);
    }catch(e){console.error(e);alert(e.message||'적립 중 오류가 발생했어요.');}finally{setBusy(false)}
  };
  const voteReward=async choice=>{
    if(!classPoint.rewardVoteActive)return;
    await setDoc(doc(db,'classRewardVotes',`${classPoint.rewardRoundId}_${auth.currentUser.uid}`),{uid:auth.currentUser.uid,studentName:auth.currentUser.displayName||'학생',roundId:classPoint.rewardRoundId,choice,updatedAt:serverTimestamp()});
    setMyVote(choice);
  };
  return <><PageHead title="우리 반 포인트" points={points}/><div className="class-point-page-grid"><div className="content-card class-goal-card"><span className="eyebrow-soft">🏫 함께 모으는 포인트</span><div className="class-goal-numbers"><strong>{total.toLocaleString()}P</strong><span>/ {goal.toLocaleString()}P</span></div><div className="class-progress large"><i style={{width:`${pct}%`}}/></div><p>목표까지 <b>{Math.max(0,goal-total).toLocaleString()}P</b> 남았어요. 내가 쓰지 않은 포인트를 우리 반을 위해 적립할 수 있어요.</p>{classPoint.rewardSelected?<div className="selected-reward">🎉 이번 목표 보상 <strong>{classPoint.rewardSelected}</strong></div>:classPoint.rewardVoteActive?<div className="selected-reward voting">🗳️ 이번 목표 보상을 투표하고 있어요!</div>:<div className="selected-reward waiting">🎁 선생님이 보상 후보를 준비하고 있어요.</div>}</div><div className="content-card"><h3>💝 우리 반에 포인트 적립</h3><p className="muted-note">내 포인트에서 원하는 만큼 선택해 우리 반 공동 포인트로 옮겨요.</p><div className="save-presets">{[1,5,10,20].map(n=><button key={n} className={Number(amount)===n?'selected':''} onClick={()=>setAmount(String(n))}>{n}P</button>)}</div><div className="save-custom"><input type="number" min="1" max={points} value={amount} onChange={e=>setAmount(e.target.value)}/><span>P</span><button disabled={busy||points<1} onClick={savePoints}>{busy?'적립 중...':'우리 반에 적립하기'}</button></div><small className="save-note">현재 내 포인트 {points}P · 적립 후 개인 포인트에서 차감됩니다.</small></div></div>{classPoint.rewardVoteActive&&<div className="content-card reward-vote-card"><h3>🗳️ 이번 목표 보상 투표</h3><p>{goal.toLocaleString()}P를 달성했을 때 받고 싶은 보상을 하나 골라요.</p><div className="reward-choice-grid">{classPoint.rewardCandidates.map(c=><button key={c} className={myVote===c?'selected':''} onClick={()=>voteReward(c)}><span>{myVote===c?'✓':'○'}</span><strong>{c}</strong></button>)}</div>{myVote&&<div className="my-vote-note">내 선택: <b>{myVote}</b> · 투표가 끝나기 전까지 바꿀 수 있어요.</div>}</div>}{!classPoint.rewardVoteActive&&!classPoint.rewardSelected&&classPoint.rewardCandidates.length>0&&<div className="content-card"><h3>🎁 보상 후보</h3><div className="candidate-preview">{classPoint.rewardCandidates.map(c=><span key={c}>{c}</span>)}</div><p className="muted-note">선생님이 투표를 시작하면 여기에서 하나를 선택할 수 있어요.</p></div>}</>;
}

function PointHistory({points}){
  const [items,setItems]=useState([]);
  useEffect(()=>onSnapshot(query(collection(db,'pointTransactions'),where('uid','==',auth.currentUser.uid)),snap=>{const rows=snap.docs.map(d=>({id:d.id,...d.data()}));rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));setItems(rows)}),[]);
  return <><PageHead title="포인트 내역" points={points}/><div className="content-card"><div className="point-history-total"><span>현재 포인트</span><strong>{points}P</strong></div>{items.length?<div className="point-history-list">{items.map(x=><div className="point-history-row" key={x.id}><div><strong>{x.reason||'포인트 변동'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><b className={x.amount>=0?'plus':'minus'}>{x.amount>=0?'+':''}{x.amount}P</b></div>)}</div>:<Empty text="아직 기록된 포인트 내역이 없어요."/>}</div></>;
}
function Notifications({go}){
 const [ws,setWs]=useState([]),[vs,setVs]=useState([]);
 useEffect(()=>{const a=onSnapshot(collection(db,'worksheets'),x=>setWs(x.docs.map(d=>({id:d.id,...d.data()})).slice(0,5)));const b=onSnapshot(query(collection(db,'votes'),where('active','==',true)),x=>setVs(x.docs.map(d=>({id:d.id,...d.data()}))));return()=>{a();b()};},[]);
 return <><PageHead title="알림"/><div className="notification-list">{ws.map(w=><button className="notification-item" key={w.id} onClick={()=>go('study')}>📚 <span><b>새 학습지 · {w.title}</b><small>학습방에서 확인하고 채점해요.</small></span> ›</button>)}{vs.map(v=><button className="notification-item" key={v.id} onClick={()=>go('vote')}>🗳️ <span><b>{v.title}</b><small>진행 중인 우리 반 투표예요.</small></span> ›</button>)}{!ws.length&&!vs.length&&<Empty text="새로운 알림이 없어요."/>}</div></>;
}

function Praise(){
  const [name,setName]=useState('');const [text,setText]=useState('');
  const submit=async e=>{e.preventDefault();await addDoc(collection(db,'praises'),{uid:auth.currentUser.uid,toName:name,text,status:'new',createdAt:serverTimestamp()});setName('');setText('');alert('칭찬을 전달했어요 💌')};
  return <><PageHead title="칭찬함"/><div className="content-card"><h3>친구에게 따뜻한 칭찬을 전해요 💗</h3><form className="form-stack" onSubmit={submit}><input value={name} onChange={e=>setName(e.target.value)} placeholder="칭찬할 친구 이름" required/><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="어떤 점을 칭찬하고 싶나요?" required/><button>칭찬 보내기</button></form></div></>;
}

function Voice(){
  const [text,setText]=useState('');const [anon,setAnon]=useState(false);
  const submit=async e=>{e.preventDefault();await addDoc(collection(db,'voices'),{uid:auth.currentUser.uid,text,anonymous:anon,status:'new',createdAt:serverTimestamp()});setText('');alert('선생님께 전달했어요 📮')};
  return <><PageHead title="불편의 소리"/><div className="content-card"><h3>우리 반을 더 좋게 만들 의견을 들려주세요.</h3><form className="form-stack" onSubmit={submit}><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="불편한 점이나 해결 아이디어를 적어주세요." required/><label className="check"><input type="checkbox" checked={anon} onChange={e=>setAnon(e.target.checked)}/> 익명으로 보내기</label><button>선생님께 보내기</button></form></div></>;
}

function Study(){
 const [items,setItems]=useState([]),[answers,setAnswers]=useState({}),[results,setResults]=useState({});
 useEffect(()=>onSnapshot(collection(db,'worksheets'),x=>setItems(x.docs.map(d=>({id:d.id,...d.data()})).filter(w=>w.published!==false))),[]);
 const norm=v=>(v||'').trim().replace(/\s+/g,' ').toLowerCase();
 const grade=async w=>{const key=w.answers||[];const mine=answers[w.id]||{};const detail=key.map(a=>({no:a.no,correct:(a.accepted||[]).map(norm).includes(norm(mine[a.no]))}));const correctCount=detail.filter(x=>x.correct).length;setResults({...results,[w.id]:detail});await setDoc(doc(db,'worksheetSubmissions',`${w.id}_${auth.currentUser.uid}`),{worksheetId:w.id,worksheetTitle:w.title,uid:auth.currentUser.uid,studentName:auth.currentUser.displayName||'학생',answers:mine,results:detail,correctCount,total:key.length,updatedAt:serverTimestamp()},{merge:true});alert(`${key.length}문제 중 ${correctCount}문제 정답!`)};
 return <><PageHead title="학습방"/><div className="study-help">📌 PDF를 열어 푼 뒤 각 번호의 답을 입력하고 <b>전체 채점하기</b>를 눌러요.</div><div className="list-stack">{items.length?items.map(w=>{const key=w.answers||[],graded=results[w.id]||[];return <div className="worksheet-card" key={w.id}><div className="worksheet-head"><div className="file-icon">📄</div><div className="grow"><strong>{w.title}</strong><span>{key.length||w.questionCount||0}문제 · 자동 채점</span></div>{w.pdfUrl&&<a className="outline-btn" href={w.pdfUrl} target="_blank" rel="noreferrer">PDF 열기</a>}</div><div className="student-answer-grid">{key.map(a=>{const r=graded.find(x=>x.no===a.no);return <label className={`student-answer-item ${r?r.correct?'correct':'wrong':''}`} key={a.no}><span>{a.no}번</span><input value={(answers[w.id]||{})[a.no]||''} onChange={e=>setAnswers({...answers,[w.id]:{...(answers[w.id]||{}),[a.no]:e.target.value}})} placeholder="정답 입력"/><i>{r?(r.correct?'✓ 정답':'✕ 오답'):''}</i></label>})}</div><button className="primary-wide" disabled={!key.length} onClick={()=>grade(w)}>전체 채점하기</button></div>}):<Empty text="선생님이 올린 학습지가 아직 없어요."/>}</div></>;
}

function Quiz({onPerfect}){
  const [idx,setIdx]=useState(0);const [selected,setSelected]=useState({});const [rewarded,setRewarded]=useState(false);
  const q=QUIZ[idx];
  const finish=async()=>{
    const score=QUIZ.filter((x,i)=>selected[i]===x.answer).length;
    if(score===5&&!rewarded){await onPerfect();setRewarded(true);alert('5문제 모두 정답! +3P 🎉')} else alert(`${score}/5 정답이에요.`);
  };
  return <><PageHead title="퀴즈방"/><div className="quiz-reward-banner">🏆 <b>5문제를 모두 맞히면 3P를 받을 수 있어요!</b><span>도전해 보세요 ✨</span></div><div className="warning-box">⚠️ <b>친구에게 정답을 알려주지 않습니다.</b></div><div className="quiz-meta"><strong>오늘의 교과 퀴즈 (5문제)</strong><span>{idx+1} / 5</span></div><div className="quiz-card"><span className="subject-pill">{q.subject}</span><h2>{q.q}</h2>{q.options.map(o=><label className={`quiz-option ${selected[idx]===o?'selected':''}`} key={o}><input type="radio" checked={selected[idx]===o} onChange={()=>setSelected({...selected,[idx]:o})}/>{o}</label>)}</div><button className="primary-wide" onClick={()=>idx<4?setIdx(idx+1):finish()}>{idx<4?'다음 문제':'채점하기'}</button></>;
}

function Gallery({onReward,points}){
  const [title,setTitle]=useState('');
  const [link,setLink]=useState('');
  const [mode,setMode]=useState('drive');
  const [items,setItems]=useState([]);
  const [driveUrl,setDriveUrl]=useState('');

  useEffect(()=>{
    const stopArt=onSnapshot(query(collection(db,'artworks'),orderBy('createdAt','desc')),s=>setItems(s.docs.map(d=>({id:d.id,...d.data()}))));
    const stopSettings=onSnapshot(doc(db,'classSettings','main'),s=>setDriveUrl(s.exists()?(s.data().driveFolderUrl||''):''));
    return ()=>{stopArt();stopSettings();};
  },[]);

  const submit=async e=>{
    e.preventDefault();
    if(!link.trim()) return alert('작품의 공유 링크를 붙여넣어 주세요.');
    await addDoc(collection(db,'artworks'),{
      uid:auth.currentUser.uid,
      studentName:auth.currentUser.displayName||'학생',
      title,
      link:link.trim(),
      sourceType:mode,
      createdAt:serverTimestamp()
    });
    await onReward();
    setTitle('');setLink('');
    alert('작품 전시 완료! +2P 🎨');
  };

  const removeArtwork=async a=>{
    if(a.uid!==auth.currentUser.uid)return;
    if(!window.confirm(`'${a.title}' 작품을 삭제할까요?\n삭제해도 받은 포인트는 자동으로 회수되지 않아요.`))return;
    await deleteDoc(doc(db,'artworks',a.id));
  };

  return <><PageHead title="작품전시관" points={points}/>
    <div className="upload-box">
      <div className="upload-plus">＋</div><h3>작품 올리기</h3>
      <p>Firebase Storage 없이 Google Drive 또는 공유 링크로 작품을 등록해요.</p>
      <div className="source-choice">
        <button type="button" className={mode==='drive'?'selected':''} onClick={()=>setMode('drive')}>📁 Google Drive에 올리기</button>
        <button type="button" className={mode==='link'?'selected':''} onClick={()=>setMode('link')}>🔗 링크로 등록하기</button>
      </div>
      {mode==='drive'&&<div className="drive-guide">
        <p>1. 아래 버튼으로 우리 반 공유 폴더를 열어 작품을 업로드해요.</p>
        {driveUrl?<a className="drive-open-btn" href={driveUrl} target="_blank" rel="noreferrer">📁 우리 반 공유 드라이브 열기</a>:<span className="setting-needed">선생님이 아직 공유 드라이브 주소를 등록하지 않았어요.</span>}
        <p>2. 업로드한 파일의 공유 링크를 복사해서 아래에 붙여넣어요.</p>
      </div>}
      {mode==='link'&&<div className="drive-guide"><p>Canva, Google Drive, Padlet 등 다른 곳에 있는 작품의 공유 링크를 바로 붙여넣어요.</p></div>}
      <form onSubmit={submit} className="upload-form">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="작품 제목" required/>
        <input value={link} onChange={e=>setLink(e.target.value)} type="url" placeholder="https://... 공유 링크 붙여넣기" required/>
        <button>전시하기 +2P</button>
      </form>
    </div>
    <h3 className="section-title">친구들의 작품</h3>
    <div className="art-grid">{items.map(a=><article className="art-card" key={a.id}><div className="link-art">{a.sourceType==='drive'?'📁':'🔗'}</div><strong>{a.title}</strong><a href={a.link} target="_blank" rel="noreferrer">작품 보러가기</a>{a.uid===auth.currentUser.uid&&<button className="danger-link" onClick={()=>removeArtwork(a)}>내 작품 삭제</button>}</article>)}</div>
  </>;
}

function Record(){
  const [text,setText]=useState('');const [items,setItems]=useState([]);
  useEffect(()=>onSnapshot(query(collection(db,'selfCompliments'),where('uid','==',auth.currentUser.uid)),s=>setItems(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  const submit=async e=>{e.preventDefault();await addDoc(collection(db,'selfCompliments'),{uid:auth.currentUser.uid,text,date:new Date().toISOString().slice(0,10),createdAt:serverTimestamp()});setText('')};
  return <><PageHead title="나의 기록"/><div className="content-card"><h3>오늘의 나에게 칭찬 한마디 💚</h3><form className="form-stack" onSubmit={submit}><input value={text} onChange={e=>setText(e.target.value)} placeholder="나는 오늘 ○○을 잘했어!" required/><button>저장하기</button></form></div><h3 className="section-title">지금까지의 기록</h3><div className="list-stack">{items.map(x=><div className="record-row" key={x.id}><span>{x.date||'오늘'}</span><p>{x.text}</p></div>)}</div></>;
}

function Vote({points}){
  const [suggestion,setSuggestion]=useState('');const [vote,setVote]=useState(null);
  useEffect(()=>onSnapshot(query(collection(db,'votes'),where('active','==',true)),s=>setVote(s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null)),[]);
  const submit=async e=>{e.preventDefault();await addDoc(collection(db,'voteSuggestions'),{uid:auth.currentUser.uid,studentName:auth.currentUser.displayName||'학생',studentEmail:auth.currentUser.email||'',text:suggestion,status:'new',createdAt:serverTimestamp()});setSuggestion('');alert('투표 안건을 선생님께 전달했어요.')};
  return <><PageHead title="우리 반 투표" points={points}/><div className="content-card compact"><h3>투표 안건 제안하기</h3><form className="inline-form" onSubmit={submit}><input value={suggestion} onChange={e=>setSuggestion(e.target.value)} placeholder="우리 반에 점심 시간 규칙이 필요할 것 같아요" required/><button>제안하기</button></form></div>{vote?<div className="content-card"><div className="vote-title"><div><span className="status">진행 중</span><h3>{vote.title}</h3></div></div>{(vote.options||[]).map((o,i)=><button className="vote-choice" key={o}>{o}<span>{18-i*4}표</span></button>)}</div>:<Empty text="현재 진행 중인 투표가 없어요."/>}</>;
}

function Coupon({points,spend}){
  const [idea,setIdea]=useState('');
  const buy=async(name,price)=>{if(!(await spend(price,`${name} 쿠폰 구매`)))return alert('포인트가 부족해요.');await addDoc(collection(db,'couponPurchases'),{uid:auth.currentUser.uid,name,price,status:'requested',createdAt:serverTimestamp()});alert(`${name} 쿠폰을 구매했어요!`)};
  const suggest=async e=>{e.preventDefault();await addDoc(collection(db,'couponSuggestions'),{uid:auth.currentUser.uid,studentName:auth.currentUser.displayName||'학생',studentEmail:auth.currentUser.email||'',text:idea,status:'new',createdAt:serverTimestamp()});setIdea('');alert('쿠폰 아이디어를 보냈어요!')};
  return <><PageHead title="쿠폰 구매" points={points}/><div className="coupon-list">{COUPONS.map(([icon,name,price])=><div className="coupon-row" key={name}><div><span>{icon}</span><strong>{name}</strong></div><b>{price}P</b><button onClick={()=>buy(name,price)}>구매</button></div>)}</div><div className="suggest-card"><div><span className="bulb">💡</span><strong>쿠폰 건의함</strong><p>~이런 쿠폰이 있으면 좋을 것 같아요!</p></div><form onSubmit={suggest}><input value={idea} onChange={e=>setIdea(e.target.value)} placeholder="새로운 쿠폰 아이디어를 적어주세요." required/><button>보내기</button></form></div></>;
}

function TeacherApp({profile}){
  const [tab,setTab]=useState('study');
  return <div className="teacher-shell"><header><div><h1>행복한 다이소반 · 교사 관리자</h1><p>{profile.name||'선생님'} · 4학년 1반</p></div><button onClick={()=>signOut(auth)}>로그아웃</button></header><div className="teacher-tabs"><button className={tab==='study'?'active':''} onClick={()=>setTab('study')}>학습방 관리</button><button className={tab==='content'?'active':''} onClick={()=>setTab('content')}>🧰 게시물 관리</button><button className={tab==='classpoints'?'active':''} onClick={()=>setTab('classpoints')}>🏫 학급 포인트</button><button className={tab==='vote'?'active':''} onClick={()=>setTab('vote')}>투표 관리</button><button className={tab==='coupon'?'active':''} onClick={()=>setTab('coupon')}>쿠폰 건의함</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>⚙️ 앱 설정</button></div>{tab==='study'&&<TeacherStudy/>}{tab==='content'&&<TeacherContentManager/>}{tab==='classpoints'&&<TeacherClassPoints/>}{tab==='vote'&&<TeacherVote/>}{tab==='coupon'&&<TeacherSuggestions/>}{tab==='settings'&&<TeacherSettings/>}</div>
}

function useDriveUrl(){
  const [driveUrl,setDriveUrl]=useState('');
  useEffect(()=>onSnapshot(doc(db,'classSettings','main'),s=>setDriveUrl(s.exists()?(s.data().driveFolderUrl||''):'')),[]);
  return driveUrl;
}

function TeacherStudy(){
 const [title,setTitle]=useState(''),[pdfUrl,setPdfUrl]=useState(''),[count,setCount]=useState(0),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[ocrBusy,setOcrBusy]=useState(false),[ocrProgress,setOcrProgress]=useState(0),[items,setItems]=useState([]),[subs,setSubs]=useState([]),[editingId,setEditingId]=useState('');const driveUrl=useDriveUrl();
 useEffect(()=>{const a=onSnapshot(collection(db,'worksheets'),x=>setItems(x.docs.map(d=>({id:d.id,...d.data()}))));const b=onSnapshot(collection(db,'worksheetSubmissions'),x=>setSubs(x.docs.map(d=>({id:d.id,...d.data()}))));return()=>{a();b()}},[]);
 const resize=n=>{n=Math.max(1,Math.min(100,Number(n)||1));setCount(n);setRows(old=>Array.from({length:n},(_,i)=>old[i]||{no:i+1,text:''}).map((x,i)=>({...x,no:i+1})))};
 const detect=async file=>{if(!file)return;setBusy(true);try{const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let text='';for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),c=await page.getTextContent();text+=' '+c.items.map(x=>x.str).join(' ')}const nums=[...text.matchAll(/(?:^|\s)(\d{1,2})[.)번]\s/g)].map(m=>+m[1]).filter(n=>n>0&&n<=100);const u=[...new Set(nums)].sort((a,b)=>a-b);let n=0;for(let i=1;i<=100;i++){if(u.includes(i))n=i;else if(n)break}resize(n||Math.max(1,...u));alert(n?`${n}개 문항을 찾았어요. 문제 수가 맞는지 확인해주세요.`:'문항 번호를 찾지 못했어요. 문제 수를 직접 입력해주세요.')}catch(e){console.error(e);resize(count||1);alert('자동 인식에 실패했어요. 문제 수를 직접 입력해주세요.')}finally{setBusy(false)}};
 const parseAnswerText=text=>{
   const clean=(text||'').replace(/\r/g,'\n').replace(/[①❶]/g,'1').replace(/[②❷]/g,'2').replace(/[③❸]/g,'3').replace(/[④❹]/g,'4').replace(/[⑤❺]/g,'5');
   const found={};
   const lines=clean.split(/\n+/).map(x=>x.trim()).filter(Boolean);
   for(const line of lines){
     const m=line.match(/^\s*(\d{1,3})\s*(?:번|[.)、:-])?\s*[:.)-]?\s*(.+?)\s*$/);
     if(m){const no=Number(m[1]);if(no>0&&no<=100&&m[2].trim())found[no]=m[2].trim();}
   }
   if(Object.keys(found).length<2){
     const re=/(?:^|\s)(\d{1,3})\s*(?:번|[.)、:-])\s*([^\n]+?)(?=(?:\s+\d{1,3}\s*(?:번|[.)、:-]))|$)/g;
     let m;while((m=re.exec(clean))){const no=Number(m[1]);if(no>0&&no<=100)found[no]=m[2].trim();}
   }
   return found;
 };
 const analyzeAnswerSheet=async file=>{
   if(!file)return;setOcrBusy(true);setOcrProgress(0);
   try{
     let text='';
     if(file.type==='application/pdf'){
       const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
       for(let i=1;i<=pdf.numPages;i++){
         const page=await pdf.getPage(i),c=await page.getTextContent();
         const pageText=c.items.map(x=>x.str).join(' ').trim();
         if(pageText.length>8){text+='\n'+pageText;setOcrProgress(Math.round(i/pdf.numPages*100));}
         else{
           const viewport=page.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;
           const result=await Tesseract.recognize(canvas,'kor+eng',{logger:m=>{if(m.status==='recognizing text')setOcrProgress(Math.round(((i-1)+(m.progress||0))/pdf.numPages*100));}});text+='\n'+(result.data.text||'');
         }
       }
     }else{
       const result=await Tesseract.recognize(file,'kor+eng',{logger:m=>{if(m.status==='recognizing text')setOcrProgress(Math.round((m.progress||0)*100));}});
       text=result.data.text||'';
     }
     const found=parseAnswerText(text), nums=Object.keys(found).map(Number).sort((a,b)=>a-b);
     if(!nums.length)return alert('답안 번호를 찾지 못했어요. 선명한 이미지로 다시 시도하거나 직접 입력해주세요.');
     const n=Math.max(...nums);setCount(n);setRows(Array.from({length:n},(_,i)=>({no:i+1,text:found[i+1]||''})));
     alert(`${nums.length}개 정답을 자동 입력했어요. 빈칸이나 잘못 인식된 답만 확인·수정해주세요.`);
   }catch(e){console.error(e);alert('답안지 자동 인식에 실패했어요. 이미지가 선명한지 확인해주세요.');}finally{setOcrBusy(false)}
 };
 const clearForm=()=>{setTitle('');setPdfUrl('');setCount(0);setRows([]);setEditingId('')};
 const submit=async e=>{e.preventDefault();const answers=rows.map(r=>({no:r.no,accepted:r.text.split('|').map(x=>x.trim()).filter(Boolean)}));if(answers.some(a=>!a.accepted.length))return alert('빈 정답이 있어요. OCR 결과에서 비어 있거나 잘못 인식된 부분만 수정해주세요.');const data={title,pdfUrl,questionCount:answers.length,answers,published:true,updatedAt:serverTimestamp()};if(editingId){await updateDoc(doc(db,'worksheets',editingId),data);alert('문제지를 수정했습니다.')}else{await addDoc(collection(db,'worksheets'),{...data,createdAt:serverTimestamp()});alert('등록 완료! 학생 학습방에 바로 나타납니다.')}clearForm()};
 const editWorksheet=w=>{setEditingId(w.id);setTitle(w.title||'');setPdfUrl(w.pdfUrl||'');const a=(w.answers||[]).map(x=>({no:x.no,text:(x.accepted||[]).join(' | ')}));setCount(w.questionCount||a.length||1);setRows(a.length?a:Array.from({length:w.questionCount||1},(_,i)=>({no:i+1,text:''})));window.scrollTo({top:0,behavior:'smooth'})};
 const removeWorksheet=async w=>{if(!window.confirm(`'${w.title}' 문제지를 삭제할까요?`))return;await deleteDoc(doc(db,'worksheets',w.id));if(editingId===w.id)clearForm()};
 return <div className="teacher-study-wrap"><div className="teacher-card"><h2>📚 {editingId?'문제지 수정':'문제지 추가'}</h2><p className="muted-note">문제지 PDF는 Drive 링크로 등록하고, 답안지는 이미지/PDF를 올리면 정답을 자동 입력합니다. 잘못 인식된 답만 수정하세요.</p>{driveUrl&&<a className="drive-open-btn inline-drive" href={driveUrl} target="_blank" rel="noreferrer">📁 우리 반 공유 드라이브 열기</a>}<form className="form-stack" onSubmit={submit}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="학습지 제목" required/><input type="url" value={pdfUrl} onChange={e=>setPdfUrl(e.target.value)} placeholder="PDF 공유 링크" required/><div className="pdf-detect-box"><b>① 문제지 PDF · 문제 수 자동 인식</b><input type="file" accept="application/pdf" onChange={e=>detect(e.target.files?.[0])}/><small>{busy?'PDF 분석 중...':'선택한 파일은 Firebase에 저장되지 않아요.'}</small></div><div className="ocr-answer-box"><div><b>② 답안지 자동 인식 (OCR)</b><span>답안지 사진·스크린샷 또는 텍스트형 PDF</span></div><input type="file" accept="image/*,application/pdf" onChange={e=>analyzeAnswerSheet(e.target.files?.[0])} disabled={ocrBusy}/>{ocrBusy&&<div className="ocr-progress"><i style={{width:`${ocrProgress}%`}}/><span>{ocrProgress}% 분석 중</span></div>}<small>예: 1. 3/4 · 2. 120 · 3. 사과처럼 번호와 정답이 함께 보이면 인식률이 좋아요.</small></div><label className="count-field"><span>③ 문제 수</span><input type="number" min="1" max="100" value={count||''} onChange={e=>resize(e.target.value)} required/></label>{rows.length>0&&<div className="answer-key-editor"><div className="answer-key-title"><b>④ OCR 결과 확인 · 수정</b><span>복수 정답은 | 로 구분</span></div>{rows.map((r,i)=><label key={r.no}><b>{r.no}번</b><input value={r.text} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,text:e.target.value}:x))} placeholder={`${r.no}번 정답`} required/></label>)}</div>}<div className="teacher-form-actions"><button className="teacher-publish-btn" disabled={busy||ocrBusy||!rows.length}>{editingId?'문제지 수정 저장':'학생에게 문제지 등록하기'}</button>{editingId&&<button type="button" className="light-action" onClick={clearForm}>수정 취소</button>}</div></form></div><div className="teacher-card"><div className="teacher-section-head"><div><h2>📄 등록된 문제지</h2><p>수정·삭제와 학생 제출 결과를 한 곳에서 관리합니다.</p></div><span className="live-badge">● 실시간</span></div>{items.map(w=>{const ss=subs.filter(s=>s.worksheetId===w.id);return <div className="teacher-worksheet-item" key={w.id}><div><b>{w.title}</b><span>{w.questionCount||0}문제 · 제출 {ss.length}명</span></div><div className="admin-actions">{w.pdfUrl&&<a href={w.pdfUrl} target="_blank" rel="noreferrer">PDF 보기</a>}<button onClick={()=>editWorksheet(w)}>수정</button><button className="danger-btn" onClick={()=>removeWorksheet(w)}>삭제</button></div></div>})}</div></div>;
}

function TeacherContentManager(){
  const groups=[
    {key:'praises',title:'💌 칭찬함',fields:['toName','text'],label:x=>`${x.toName||'친구'} · ${x.text||''}`},
    {key:'voices',title:'📮 불편의 소리',fields:['text'],label:x=>`${x.anonymous?'익명':'학생'} · ${x.text||''}`},
    {key:'artworks',title:'🎨 작품전시관',fields:['title','link'],label:x=>`${x.title||'작품'} · ${x.link||''}`},
    {key:'selfCompliments',title:'🌱 나의 기록',fields:['text'],label:x=>`${x.date||''} · ${x.text||''}`},
    {key:'couponPurchases',title:'🎟️ 쿠폰 구매 요청',fields:['status'],label:x=>`${x.name||'쿠폰'} · ${x.price||0}P · ${x.status||''}`},
  ];
  const [active,setActive]=useState('praises'),[items,setItems]=useState([]),[loading,setLoading]=useState(true);
  const group=groups.find(g=>g.key===active)||groups[0];
  useEffect(()=>{setLoading(true);const q=query(collection(db,active),orderBy('createdAt','desc'));return onSnapshot(q,s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)},()=>{onSnapshot(collection(db,active),s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)})})},[active]);
  const editItem=async item=>{
    const patch={};
    for(const f of group.fields){const next=window.prompt(`${f==='text'?'내용':f==='title'?'제목':f==='link'?'링크':f==='toName'?'칭찬할 친구':f==='status'?'상태':f} 수정`,item[f]??'');if(next===null)return;patch[f]=next.trim();}
    await updateDoc(doc(db,active,item.id),patch);alert('수정했습니다.');
  };
  const removeItem=async item=>{if(!window.confirm('이 게시물을 삭제할까요?'))return;await deleteDoc(doc(db,active,item.id))};
  const addItem=async()=>{
    const base={uid:auth.currentUser.uid,studentName:'선생님',createdAt:serverTimestamp()};
    if(active==='praises'){const toName=prompt('칭찬할 친구 이름');if(!toName)return;const text=prompt('칭찬 내용');if(!text)return;await addDoc(collection(db,active),{...base,toName,text,status:'new'})}
    else if(active==='voices'){const text=prompt('등록할 의견/안내 내용');if(!text)return;await addDoc(collection(db,active),{...base,text,anonymous:false,status:'new'})}
    else if(active==='artworks'){const title=prompt('작품 제목');if(!title)return;const link=prompt('작품 공유 링크');if(!link)return;await addDoc(collection(db,active),{...base,title,link,sourceType:'link'})}
    else if(active==='selfCompliments'){const text=prompt('기록 내용');if(!text)return;await addDoc(collection(db,active),{...base,text,date:new Date().toISOString().slice(0,10)})}
    else return alert('쿠폰 구매 요청은 학생이 구매할 때 생성됩니다.');
    alert('추가했습니다.');
  };
  return <div className="teacher-card"><div className="teacher-section-head"><div><h2>🧰 게시물 통합 관리</h2><p>학생이 등록한 내용을 메뉴별로 확인하고 교사가 추가·수정·삭제할 수 있습니다.</p></div><button className="primary-action" onClick={addItem}>+ 새 게시물</button></div><div className="admin-subtabs">{groups.map(g=><button key={g.key} className={active===g.key?'active':''} onClick={()=>setActive(g.key)}>{g.title}</button>)}</div>{loading?<div className="empty-card">불러오는 중...</div>:items.length?<div className="teacher-suggestion-list">{items.map(x=><div className="teacher-suggestion-item" key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{x.studentName||x.name||'학생'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><p>{group.label(x)}</p></div><div className="admin-actions"><button className="small-action" onClick={()=>editItem(x)}>수정</button><button className="danger-btn" onClick={()=>removeItem(x)}>삭제</button></div></div>)}</div>:<Empty text="등록된 게시물이 없어요."/>}</div>
}

function TeacherClassPoints(){
  const classPoint=useClassPointData();
  const [goal,setGoal]=useState('3000');
  const [candidates,setCandidates]=useState([]);
  const [candidateText,setCandidateText]=useState('');
  const [votes,setVotes]=useState([]);
  useEffect(()=>{setGoal(String(classPoint.goal||3000));setCandidates(classPoint.rewardCandidates||[])},[classPoint.goal,JSON.stringify(classPoint.rewardCandidates)]);
  useEffect(()=>onSnapshot(query(collection(db,'classRewardVotes'),where('roundId','==',classPoint.rewardRoundId||1)),snap=>setVotes(snap.docs.map(d=>({id:d.id,...d.data()})))),[classPoint.rewardRoundId]);
  const saveGoal=async()=>{const n=Math.max(100,Math.floor(Number(goal)||3000));await setDoc(doc(db,'classSettings','main'),{classPointGoal:n,rewardRoundId:classPoint.rewardRoundId||1},{merge:true});setGoal(String(n));alert(`학급 목표를 ${n.toLocaleString()}P로 저장했습니다.`)};
  const addCandidate=()=>{const v=candidateText.trim();if(!v)return;if(candidates.includes(v))return alert('이미 있는 후보예요.');if(candidates.length>=6)return alert('보상 후보는 최대 6개까지 등록할 수 있어요.');setCandidates([...candidates,v]);setCandidateText('')};
  const saveCandidates=async()=>{if(candidates.length<2)return alert('보상 후보를 2개 이상 등록해주세요.');await setDoc(doc(db,'classSettings','main'),{rewardCandidates:candidates},{merge:true});alert('보상 후보를 저장했습니다.')};
  const startVote=async()=>{if(candidates.length<2)return alert('후보를 2개 이상 등록해주세요.');if(!window.confirm('학생들에게 이번 목표 보상 투표를 시작할까요?'))return;await setDoc(doc(db,'classSettings','main'),{rewardCandidates:candidates,rewardVoteActive:true,rewardSelected:'',rewardVoteStartedAt:serverTimestamp()},{merge:true});alert('학생 화면에 보상 투표가 시작되었습니다.')};
  const counts=candidates.map(c=>({name:c,count:votes.filter(v=>v.choice===c).length}));
  const finishVote=async()=>{if(!votes.length)return alert('아직 투표한 학생이 없어요.');const max=Math.max(...counts.map(x=>x.count));const winners=counts.filter(x=>x.count===max);if(winners.length!==1)return alert('현재 1위가 동점이에요. 투표를 조금 더 진행하거나 다시 투표해주세요.');const winner=winners[0].name;if(!window.confirm(`투표를 종료하고 '${winner}'을(를) 이번 목표 보상으로 확정할까요?`))return;await setDoc(doc(db,'classSettings','main'),{rewardVoteActive:false,rewardSelected:winner,rewardVoteEndedAt:serverTimestamp()},{merge:true});alert(`이번 목표 보상은 '${winner}'으로 확정되었습니다!`)};
  const newRound=async()=>{if(!window.confirm('현재 보상을 완료 처리하고 학급 포인트를 0P부터 새로 시작할까요?\n이전 적립 내역은 기록으로 남습니다.'))return;await setDoc(doc(db,'classSettings','main'),{rewardRoundId:(classPoint.rewardRoundId||1)+1,rewardVoteActive:false,rewardSelected:'',rewardCandidates:[],rewardRoundStartedAt:serverTimestamp()},{merge:true});setCandidates([]);alert('새 학급 포인트 목표를 시작했습니다.')};
  return <div className="teacher-classpoint-grid"><div className="teacher-card"><div className="teacher-section-head"><div><h2>🏫 학급 포인트 관리</h2><p>학생들이 개인 포인트를 우리 반 공동 포인트로 적립한 결과입니다.</p></div><span className="live-badge">● 실시간</span></div><div className="teacher-class-total"><div><span>현재 학급 포인트</span><strong>{classPoint.total.toLocaleString()}P</strong></div><div><span>목표</span><strong>{classPoint.goal.toLocaleString()}P</strong></div></div><div className="class-progress large"><i style={{width:`${Math.min(100,classPoint.total/classPoint.goal*100)}%`}}/></div><div className="goal-editor"><label><span>목표 포인트</span><input type="number" min="100" step="100" value={goal} onChange={e=>setGoal(e.target.value)}/></label><button onClick={saveGoal}>목표 저장</button></div>{classPoint.rewardSelected&&<div className="teacher-selected-reward"><span>🎉 현재 확정 보상</span><strong>{classPoint.rewardSelected}</strong></div>}</div><div className="teacher-card"><h2>🎁 이번 목표 보상 후보</h2><p className="muted-note">선생님이 원하는 후보를 몇 개 등록한 뒤 투표를 시작하세요. 처음에는 학생 화면에 후보가 보이고, 투표 종료 후에는 선택된 보상 하나만 강조해서 보입니다.</p><div className="candidate-editor"><div className="candidate-add"><input value={candidateText} onChange={e=>setCandidateText(e.target.value)} placeholder="예: 과자 파티" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCandidate()}}}/><button onClick={addCandidate}>후보 추가</button></div><div className="candidate-chips">{candidates.map(c=><span key={c}>{c}<button onClick={()=>setCandidates(candidates.filter(x=>x!==c))}>×</button></span>)}</div><div className="candidate-actions"><button className="light-action" onClick={saveCandidates}>후보 저장</button><button className="primary-action" disabled={classPoint.rewardVoteActive||!!classPoint.rewardSelected||candidates.length<2} onClick={startVote}>{classPoint.rewardVoteActive?'투표 진행 중':classPoint.rewardSelected?'보상 확정 완료':'학생 투표 시작'}</button></div></div></div>{classPoint.rewardVoteActive&&<div className="teacher-card"><div className="teacher-section-head"><div><h2>🗳️ 보상 투표 현황</h2><p>총 {votes.length}명이 참여했습니다.</p></div><span className="live-badge">● 실시간</span></div><div className="reward-tally">{counts.map(x=><div key={x.name}><span>{x.name}</span><strong>{x.count}표</strong></div>)}</div><button className="finish-vote-btn" onClick={finishVote}>투표 종료 · 1위 보상 확정</button></div>}<div className="teacher-card"><h2>🔄 다음 목표 시작</h2><p className="muted-note">보상을 실제로 제공한 뒤 사용하세요. 누르면 현재 회차는 기록으로 남고 학급 포인트가 새 회차에서 0P부터 시작합니다.</p><button className="new-round-btn" disabled={!classPoint.rewardSelected} onClick={newRound}>보상 완료 · 새 목표 시작</button></div><div className="teacher-card"><h2>🌱 학생 적립 내역</h2>{classPoint.contributions.length?<div className="teacher-suggestion-list">{[...classPoint.contributions].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).map(x=><div className="teacher-suggestion-item" key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{x.studentName||'학생'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><p>우리 반 포인트 적립</p></div><b className="class-add-amount">+{x.amount}P</b></div>)}</div>:<Empty text="아직 이번 회차에 적립된 학급 포인트가 없어요."/>}</div></div>;
}

function TeacherSettings(){
  const [driveUrl,setDriveUrl]=useState('');
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{getDoc(doc(db,'classSettings','main')).then(s=>{if(s.exists())setDriveUrl(s.data().driveFolderUrl||'');setLoaded(true);});},[]);
  const save=async e=>{e.preventDefault();await setDoc(doc(db,'classSettings','main'),{driveFolderUrl:driveUrl.trim(),updatedAt:serverTimestamp()},{merge:true});alert('공유 드라이브 주소를 저장했습니다.');};
  return <div className="teacher-card"><h2>⚙️ 앱 설정</h2><h3>📁 우리 반 공유 드라이브 폴더</h3><p className="muted-note">학생 작품과 PDF 학습지를 올릴 Google Drive 폴더의 공유 주소를 한 번만 등록하세요.</p><form className="form-stack" onSubmit={save}><input value={driveUrl} onChange={e=>setDriveUrl(e.target.value)} type="url" placeholder="https://drive.google.com/drive/folders/..." required/><button disabled={!loaded}>공유 드라이브 주소 저장</button></form><div className="settings-tip"><b>Google Drive 권한도 확인하세요.</b><span>학생들이 파일을 직접 올리려면 해당 폴더에 업로드 가능한 권한이 있어야 합니다. 작품 링크를 다른 학생도 보게 하려면 파일 공유 권한도 알맞게 설정해야 합니다.</span></div></div>
}

function formatCreatedAt(value){
  if(!value?.toDate) return '방금 전';
  return value.toDate().toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function TeacherVote(){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{const q=query(collection(db,'voteSuggestions'),orderBy('createdAt','desc'));return onSnapshot(q,s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)},err=>{console.error(err);setLoading(false)})},[]);
  const markDone=async item=>updateDoc(doc(db,'voteSuggestions',item.id),{status:item.status==='done'?'new':'done'});
  const editItem=async item=>{const text=window.prompt('투표 안건 내용을 수정하세요.',item.text||'');if(text===null||!text.trim())return;await updateDoc(doc(db,'voteSuggestions',item.id),{text:text.trim()})};
  const removeItem=async item=>{if(!window.confirm('이 투표 안건 제안을 삭제할까요?'))return;await deleteDoc(doc(db,'voteSuggestions',item.id))};
  const addItem=async()=>{const text=window.prompt('교사가 새 투표 안건을 추가합니다.');if(!text?.trim())return;await addDoc(collection(db,'voteSuggestions'),{uid:auth.currentUser.uid,studentName:'선생님',text:text.trim(),status:'new',createdAt:serverTimestamp()})};
  return <div className="teacher-card"><div className="teacher-section-head"><div><h2>🗳️ 투표 관리</h2><p>학생 제안을 실시간으로 확인하고 추가·수정·삭제할 수 있습니다.</p></div><button className="primary-action" onClick={addItem}>+ 안건 추가</button></div>{loading?<div className="empty-card">불러오는 중...</div>:items.length===0?<Empty text="아직 들어온 투표 안건 제안이 없어요."/>:<div className="teacher-suggestion-list">{items.map(x=><div className={`teacher-suggestion-item ${x.status==='done'?'done':''}`} key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{x.studentName||'학생'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><p>{x.text}</p></div><div className="admin-actions"><button className="small-action" onClick={()=>markDone(x)}>{x.status==='done'?'다시 보기':'확인 완료'}</button><button className="small-action" onClick={()=>editItem(x)}>수정</button><button className="danger-btn" onClick={()=>removeItem(x)}>삭제</button></div></div>)}</div>}</div>
}

function TeacherSuggestions(){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{const q=query(collection(db,'couponSuggestions'),orderBy('createdAt','desc'));return onSnapshot(q,s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)},err=>{console.error(err);setLoading(false)})},[]);
  const markDone=async item=>updateDoc(doc(db,'couponSuggestions',item.id),{status:item.status==='done'?'new':'done'});
  const editItem=async item=>{const text=window.prompt('쿠폰 아이디어를 수정하세요.',item.text||'');if(text===null||!text.trim())return;await updateDoc(doc(db,'couponSuggestions',item.id),{text:text.trim()})};
  const removeItem=async item=>{if(!window.confirm('이 쿠폰 아이디어를 삭제할까요?'))return;await deleteDoc(doc(db,'couponSuggestions',item.id))};
  const addItem=async()=>{const text=window.prompt('교사가 새 쿠폰 아이디어를 추가합니다.');if(!text?.trim())return;await addDoc(collection(db,'couponSuggestions'),{uid:auth.currentUser.uid,studentName:'선생님',text:text.trim(),status:'new',createdAt:serverTimestamp()})};
  return <div className="teacher-card"><div className="teacher-section-head"><div><h2>💡 쿠폰 건의함</h2><p>학생 아이디어를 실시간으로 확인하고 추가·수정·삭제할 수 있습니다.</p></div><button className="primary-action" onClick={addItem}>+ 아이디어 추가</button></div>{loading?<div className="empty-card">불러오는 중...</div>:items.length===0?<Empty text="아직 들어온 쿠폰 아이디어가 없어요."/>:<div className="teacher-suggestion-list">{items.map(x=><div className={`teacher-suggestion-item ${x.status==='done'?'done':''}`} key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{x.studentName||'학생'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><p>{x.text}</p></div><div className="admin-actions"><button className="small-action" onClick={()=>markDone(x)}>{x.status==='done'?'다시 보기':'확인 완료'}</button><button className="small-action" onClick={()=>editItem(x)}>수정</button><button className="danger-btn" onClick={()=>removeItem(x)}>삭제</button></div></div>)}</div>}</div>
}

function Empty({text}){return <div className="empty-card">🌿<p>{text}</p></div>}
