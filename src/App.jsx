import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from 'firebase/auth';
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, runTransaction, deleteDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

// 4학년 교육과정 범위에서 날짜마다 새로운 5문제를 만들어 저장합니다.
// 고정된 30문제 풀을 반복하지 않고, 날짜를 seed로 사용해 문항의 수치·상황·선택지를 바꿉니다.
function quizDateKey(){
  return localDateKey();
}

function hashText(text){
  let h=2166136261;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function seededRandom(seedText){
  let seed=hashText(seedText);
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}

function pick(rand,arr){
  return arr[Math.floor(rand()*arr.length)];
}

function shuffle(rand,arr){
  const out=[...arr];
  for(let i=out.length-1;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}

function makeOptions(rand,answer,wrong){
  return shuffle(rand,[answer,...wrong.filter(x=>x!==answer).slice(0,3)]);
}


const QUIZ_DIFFICULTY_LABELS={
  easy:'기본',
  medium:'응용',
  hard:'도전',
};

function buildKoreanQuestion(rand,difficulty='medium'){
  const banks={
    easy:[
      ['다음 중 사실을 나타내는 문장은 무엇일까요?','우리 학교 도서관은 2층에 있다.',['우리 학교 도서관이 가장 멋지다.','나는 도서관이 정말 좋다.','도서관 책은 모두 재미있다.']],
      ['국어사전에서 낱말을 찾을 때 기본이 되는 순서는 무엇일까요?','가나다순',['글자 수가 많은 순','뜻이 긴 순','내가 좋아하는 순']],
      ['글을 요약할 때 가장 알맞은 방법은 무엇일까요?','중요한 내용을 간추려 짧게 나타낸다.',['모든 문장을 그대로 옮긴다.','내 생각만 길게 쓴다.','삽화의 색깔만 설명한다.']],
      ['친구의 의견을 들을 때 가장 알맞은 태도는 무엇일까요?','말을 끝까지 듣고 까닭을 생각한다.',['내 생각과 다르면 바로 끊는다.','친구가 말할 때 다른 일을 한다.','큰 소리로 내 의견만 반복한다.']],
    ],
    medium:[
      ['글의 제목과 반복되는 내용을 살펴보는 가장 큰 까닭은 무엇일까요?','글의 중심 생각을 찾기 위해서',['글자 수를 세기 위해서','문단 번호를 정하기 위해서','종이의 크기를 알기 위해서']],
      ['의견을 뒷받침하는 까닭을 말하면 좋은 점은 무엇일까요?','내 생각을 더 분명하게 전달할 수 있다.',['말을 더 빨리 끝낼 수 있다.','상대의 말을 듣지 않아도 된다.','항상 내 의견만 옳게 된다.']],
      ['“학교 운동장에 그늘막을 더 설치해야 합니다. 여름에는 햇볕이 강해 쉬기 어렵기 때문입니다.”에서 의견을 뒷받침하는 까닭은 무엇일까요?','여름에는 햇볕이 강해 쉬기 어렵기 때문이다.',['학교 운동장이 넓기 때문이다.','그늘막의 색이 예쁘기 때문이다.','친구들이 운동을 좋아하기 때문이다.']],
      ['두 문단의 공통된 내용을 묶어 한 문장으로 나타내려 할 때 가장 먼저 할 일은 무엇일까요?','각 문단의 중요한 내용을 찾는다.',['문단의 글자 수를 센다.','가장 긴 문장을 그대로 옮긴다.','모든 문장을 같은 길이로 줄인다.']],
    ],
    hard:[
      ['“우리 반은 매주 금요일 책을 읽습니다. 책을 읽으면 새로운 정보를 얻고, 다른 사람의 생각도 이해할 수 있습니다.” 이 글의 중심 생각으로 가장 알맞은 것은?','책 읽기는 새로운 정보와 다른 사람의 생각을 이해하는 데 도움이 된다.',['우리 반은 금요일마다 체육을 한다.','책은 반드시 금요일에만 읽어야 한다.','새로운 정보는 책이 아닌 곳에서만 얻을 수 있다.']],
      ['친구가 “학교에 식물을 더 심자.”라고 주장했습니다. 이 의견을 가장 잘 뒷받침하는 자료는 무엇일까요?','학교의 녹지 면적과 여름철 그늘 부족을 조사한 자료',['친구들이 좋아하는 급식 순위','학급에서 키우는 애완동물 사진','운동회 종목 목록']],
      ['다음 중 같은 낱말이 서로 다른 뜻으로 쓰인 예로 가장 알맞은 것은?','“길이 막혔다.”와 “말문이 막혔다.”',['“비가 온다.”와 “눈이 온다.”','“책을 읽다.”와 “신문을 읽다.”','“밥을 먹다.”와 “빵을 먹다.”']],
      ['주장하는 글을 고쳐 쓸 때 가장 먼저 확인할 내용으로 알맞은 것은?','주장과 까닭이 서로 잘 연결되는지 확인한다.',['문장 수가 정확히 같은지 확인한다.','모든 문장의 끝말이 같은지 확인한다.','글씨 크기가 모두 같은지 확인한다.']],
    ]
  };
  const [q,answer,wrong]=pick(rand,banks[difficulty]||banks.medium);
  return {subject:'국어',difficulty,q,options:makeOptions(rand,answer,wrong),answer};
}

function buildMathQuestion(rand,difficulty='medium'){
  let q,answer,wrong;
  if(difficulty==='easy'){
    const kind=Math.floor(rand()*4);
    if(kind===0){
      const a=(Math.floor(rand()*70)+20)*1000, b=(Math.floor(rand()*8)+1)*1000;
      answer=(a-b).toLocaleString('ko-KR');
      q=`${a.toLocaleString('ko-KR')}에서 ${b.toLocaleString('ko-KR')}을 빼면 얼마일까요?`;
      wrong=[(a+b).toLocaleString('ko-KR'),(a-b+1000).toLocaleString('ko-KR'),(a-b-1000).toLocaleString('ko-KR')];
    }else if(kind===1){
      const a=Math.floor(rand()*70)+20,b=Math.floor(rand()*8)+2,v=a*b;
      answer=String(v);q=`${a}×${b}의 값은 얼마일까요?`;
      wrong=[String(v+b),String(v-b),String(a+b)];
    }else if(kind===2){
      const b=Math.floor(rand()*7)+3,c=Math.floor(rand()*8)+2,a=b*c;
      answer=String(c);q=`${a}÷${b}의 몫은 얼마일까요?`;
      wrong=[String(c+1),String(Math.max(1,c-1)),String(b)];
    }else{
      const km=Math.floor(rand()*8)+2;
      answer=`${km*1000}m`;q=`${km}km는 몇 m일까요?`;
      wrong=[`${km*100}m`,`${km*10}m`,`${km*10000}m`];
    }
  }else if(difficulty==='hard'){
    const kind=Math.floor(rand()*5);
    if(kind===0){
      const packs=Math.floor(rand()*7)+4,each=Math.floor(rand()*25)+16,give=Math.floor(rand()*30)+10;
      const total=packs*each-give;
      q=`연필이 한 상자에 ${each}자루씩 ${packs}상자 있습니다. 그중 ${give}자루를 나누어 주었습니다. 남은 연필은 몇 자루일까요?`;
      answer=String(total);
      wrong=[String(packs*each+give),String(packs+each-give),String(total+each)];
    }else if(kind===1){
      const den=Math.floor(rand()*5)+6;
      let a=Math.floor(rand()*(den-2))+1,b=Math.floor(rand()*(den-a-1))+1;
      q=`민지는 케이크의 ${a}/${den}, 현우는 ${b}/${den}만큼 먹었습니다. 두 사람이 먹은 양을 합하면 전체의 얼마일까요?`;
      answer=`${a+b}/${den}`;
      wrong=[`${a+b}/${den*2}`,`${Math.abs(a-b)}/${den}`,`${Math.min(den-1,a+b+1)}/${den}`];
    }else if(kind===2){
      const a=(Math.floor(rand()*5)+4)*10,b=(Math.floor(rand()*4)+2)*10,c=180-a-b;
      q=`삼각형의 두 각이 ${a}°와 ${b}°입니다. 나머지 한 각의 크기는 몇 도일까요?`;
      answer=`${c}°`;
      wrong=[`${180-c}°`,`${c+20}°`,`${Math.max(10,c-20)}°`];
    }else if(kind===3){
      const n=Math.floor(rand()*7)+3,price=(Math.floor(rand()*7)+2)*100;
      const paid=Math.ceil((n*price)/1000)*1000;
      const change=paid-n*price;
      q=`공책 한 권이 ${price.toLocaleString()}원입니다. ${n}권을 사고 ${paid.toLocaleString()}원을 냈다면 거스름돈은 얼마일까요?`;
      answer=`${change.toLocaleString()}원`;
      wrong=[`${(change+price).toLocaleString()}원`,`${Math.max(0,change-price).toLocaleString()}원`,`${(paid-price).toLocaleString()}원`];
    }else{
      const side=Math.floor(rand()*7)+3;
      q=`한 변의 길이가 ${side}cm인 정사각형의 네 변의 길이를 모두 더하면 몇 cm일까요?`;
      answer=`${side*4}cm`;
      wrong=[`${side*2}cm`,`${side*side}cm`,`${side+4}cm`];
    }
  }else{
    const kind=Math.floor(rand()*5);
    if(kind===0){
      const den=Math.floor(rand()*7)+5,a=Math.floor(rand()*(den-2))+1,b=Math.floor(rand()*(den-a-1))+1;
      answer=`${a+b}/${den}`;q=`${a}/${den}와 ${b}/${den}를 더하면 얼마일까요?`;
      wrong=[`${a+b}/${den*2}`,`${Math.abs(a-b)}/${den}`,`${a+b+1}/${den}`];
    }else if(kind===1){
      const den=Math.floor(rand()*7)+5,a=Math.floor(rand()*(den-2))+2,b=Math.floor(rand()*(a-1))+1;
      answer=`${a-b}/${den}`;q=`${a}/${den}에서 ${b}/${den}를 빼면 얼마일까요?`;
      wrong=[`${a+b}/${den}`,`${a-b}/${den*2}`,`${a-b+1}/${den}`];
    }else if(kind===2){
      const a=(Math.floor(rand()*10)+3)*10,b=(Math.floor(rand()*5)+2)*10,c=180-a-b;
      if(c<=0)return buildMathQuestion(rand,difficulty);
      answer=`${c}°`;q=`삼각형의 두 각이 ${a}°와 ${b}°일 때, 나머지 한 각은 몇 도일까요?`;
      wrong=[`${180-c}°`,`${c+10}°`,`${Math.max(10,c-10)}°`];
    }else if(kind===3){
      const a=Math.floor(rand()*5000)+2500,b=Math.floor(rand()*1800)+500;
      q=`어떤 수에 ${b.toLocaleString()}을 더했더니 ${(a+b).toLocaleString()}이 되었습니다. 어떤 수는 얼마일까요?`;
      answer=a.toLocaleString();
      wrong=[(a+b+b).toLocaleString(),Math.max(0,a-b).toLocaleString(),(a+100).toLocaleString()];
    }else{
      const rows=Math.floor(rand()*5)+3,cols=Math.floor(rand()*6)+4;
      q=`의자를 한 줄에 ${cols}개씩 ${rows}줄 놓았습니다. 의자는 모두 몇 개일까요?`;
      answer=String(rows*cols);
      wrong=[String(rows+cols),String(rows*cols+cols),String(rows*cols-rows)];
    }
  }
  return {subject:'수학',difficulty,q,options:makeOptions(rand,answer,wrong),answer};
}

function buildSocialQuestion(rand,difficulty='medium'){
  const banks={
    easy:[
      ['지도에서 실제 거리를 일정한 비율로 줄여 나타낸 정도를 무엇이라고 할까요?','축척',['방위','범례','기호']],
      ['지도에서 동서남북의 방향을 나타내는 것을 무엇이라고 할까요?','방위',['축척','범례','등고선']],
      ['지도에 사용된 기호의 뜻을 설명해 놓은 것은 무엇일까요?','범례',['방위','축척','제목']],
      ['여러 사람이 함께 이용하도록 만든 시설에 해당하는 것은 무엇일까요?','도서관',['개인 침실','개인 장난감','가정용 냉장고']],
    ],
    medium:[
      ['지역의 모습을 조사할 때 도움이 되는 자료로 가장 알맞은 것은?','지도와 사진, 현장 조사 기록',['친구의 별명 목록','게임 점수표','개인 비밀번호']],
      ['우리 지역의 문제를 해결하는 바른 방법은 무엇일까요?','주민의 의견을 모아 해결 방법을 찾는다.',['한 사람의 생각만 따른다.','문제를 그냥 둔다.','아무도 모르게 결정한다.']],
      ['주민 참여의 좋은 점으로 알맞은 것은 무엇일까요?','지역 문제 해결에 다양한 의견을 반영할 수 있다.',['모든 결정을 한 사람이 하게 된다.','지역 문제를 숨길 수 있다.','주민의 의견을 들을 필요가 없어진다.']],
      ['새로운 도로를 만들기 전 지역 주민의 의견을 조사하는 가장 알맞은 방법은?','설문 조사와 주민 회의를 함께 활용한다.',['한 사람에게만 물어본다.','아무에게도 알리지 않는다.','다른 지역의 의견만 조사한다.']],
    ],
    hard:[
      ['학교 주변의 불법 주정차 문제 원인을 알아보려 합니다. 가장 적절한 조사 방법은?','시간대별 현장 관찰과 주민·운전자 의견 조사를 함께 한다.',['인터넷 사진 한 장만 보고 결정한다.','문제 장소와 관계없는 지역만 조사한다.','친구 한 명의 생각을 전체 의견으로 정한다.']],
      ['두 지역의 인구와 시설을 비교하려고 합니다. 가장 적절한 자료 조합은 무엇일까요?','인구 통계와 시설 분포 지도',['좋아하는 음식 설문과 일기','게임 이용 시간과 노래 순위','개인 사진과 비밀번호']],
      ['지도에서 축척이 1cm가 실제 500m를 뜻합니다. 지도에서 두 장소 사이가 4cm라면 실제 거리는?','2km',['200m','500m','4km']],
      ['지역 문제 해결 방안 여러 개 중 하나를 정할 때 가장 바람직한 기준은?','효과, 비용, 주민 의견을 함께 살펴본다.',['가장 먼저 나온 의견만 따른다.','가장 비싼 방법을 무조건 고른다.','의견이 다른 사람을 제외한다.']],
    ]
  };
  const [q,answer,wrong]=pick(rand,banks[difficulty]||banks.medium);
  return {subject:'사회',difficulty,q,options:makeOptions(rand,answer,wrong),answer};
}

function buildScienceQuestion(rand,difficulty='medium'){
  const banks={
    easy:[
      ['식물의 뿌리가 하는 일로 알맞은 것은 무엇일까요?','물을 흡수한다.',['꽃가루를 만든다.','열매를 먹는다.','햇빛을 가린다.']],
      ['식물의 줄기가 하는 일로 알맞은 것은 무엇일까요?','물과 양분이 이동하는 통로가 된다.',['씨를 땅속에 묻는다.','빛을 완전히 막는다.','뿌리를 대신해 흙을 만든다.']],
      ['물이 얼어 고체 상태가 된 것은 무엇일까요?','얼음',['수증기','안개','이슬']],
      ['자석에 잘 붙는 물체의 재료는 무엇일까요?','철',['나무','종이','고무']],
    ],
    medium:[
      ['물이 끓을 때 물 표면과 물속에서 일어나는 변화로 알맞은 것은?','물이 수증기로 변한다.',['물이 얼음으로 변한다.','물이 흙으로 변한다.','물이 사라져 아무것도 되지 않는다.']],
      ['그림자가 생기기 위해 필요한 조건으로 알맞은 것은?','빛과 빛을 막는 물체',['소리와 공기','물과 흙','바람과 구름']],
      ['자석의 같은 극끼리 가까이 가져가면 어떻게 될까요?','서로 밀어낸다.',['서로 끌어당긴다.','항상 붙어서 움직이지 않는다.','자석의 성질이 사라진다.']],
      ['식물이 잘 자라기 위한 조건을 알아보는 실험에서 한 가지 조건만 다르게 하는 까닭은?','그 조건이 식물의 자람에 미치는 영향을 비교하기 위해서',['실험 시간을 무조건 줄이기 위해서','화분을 더 예쁘게 꾸미기 위해서','결과를 원하는 대로 만들기 위해서']],
    ],
    hard:[
      ['같은 크기의 화분 두 개에 같은 식물을 심었습니다. A에는 빛을 주고 B에는 빛을 주지 않았으며 물과 온도는 같게 했습니다. 이 실험에서 알아보려는 것은?','빛이 식물의 자람에 미치는 영향',['물의 양이 식물의 자람에 미치는 영향','화분 크기가 식물의 자람에 미치는 영향','흙의 색이 식물의 자람에 미치는 영향']],
      ['찬 음료가 든 컵 바깥쪽에 잠시 뒤 물방울이 맺혔습니다. 가장 알맞은 설명은?','공기 중 수증기가 차가운 컵 주변에서 물로 변했다.',['컵 안의 물이 컵 벽을 그대로 통과했다.','컵이 스스로 물을 만들었다.','공기 중 산소가 얼음으로 변했다.']],
      ['전등과 물체 사이의 거리를 그대로 두고 물체를 벽에 더 가까이 옮기면 일반적으로 그림자는 어떻게 될까요?','더 작아진다.',['더 커진다.','항상 완전히 사라진다.','색이 빨간색으로 변한다.']],
      ['막대자석의 N극 가까이에 다른 막대자석의 S극을 가져갔습니다. 예상되는 현상은?','서로 끌어당긴다.',['서로 밀어낸다.','아무 힘도 작용하지 않는다.','두 자석 모두 자성을 잃는다.']],
    ]
  };
  const [q,answer,wrong]=pick(rand,banks[difficulty]||banks.medium);
  return {subject:'과학',difficulty,q,options:makeOptions(rand,answer,wrong),answer};
}

function buildEnglishQuestion(rand,difficulty='medium'){
  const banks={
    easy:[
      ['“How are you?”에 알맞은 대답은 무엇일까요?','I’m fine, thank you.',['It is a pencil.','I am ten o’clock.','This is Monday.']],
      ['“What time is it?”에 알맞은 대답은 무엇일까요?','It’s three o’clock.',['I’m happy.','It’s sunny.','I like apples.']],
      ['“How’s the weather?”에 알맞은 대답은 무엇일까요?','It’s sunny.',['I’m eleven.','It’s a desk.','I can swim.']],
      ['“Can you swim?”에 알맞은 대답은 무엇일까요?','Yes, I can.',['Yes, it is.','I’m a student.','It’s seven.']],
    ],
    medium:[
      ['친구가 “Do you like apples?”라고 물었습니다. 사과를 좋아한다고 대답하려면?','Yes, I do.',['Yes, I am.','Yes, it is.','Yes, I can.']],
      ['“What is this?”에 알맞은 대답은 무엇일까요?','It’s a book.',['I’m fine.','It’s Monday.','I can dance.']],
      ['친구에게 지금 시각을 묻는 표현으로 알맞은 것은?','What time is it?',['How old are you?','What is this?','How’s the weather?']],
      ['친구에게 수영을 할 수 있는지 묻는 표현으로 알맞은 것은?','Can you swim?',['Do you like swimming?','What time is it?','How are you?']],
    ],
    hard:[
      ['A: “Can you play the piano?” B: “_____. I can play very well.” 빈칸에 알맞은 말은?','Yes, I can.',['No, I can’t.','Yes, I do.','It’s a piano.']],
      ['A: “How’s the weather?” B: “It’s rainy.” 이 대화에서 알 수 있는 것은?','비가 오는 날씨이다.',['지금 세 시이다.','친구가 수영을 잘한다.','책상 위에 책이 있다.']],
      ['A: “Do you like pizza?” B: “No, I don’t.” B의 뜻으로 알맞은 것은?','피자를 좋아하지 않는다.',['피자를 만들 수 없다.','피자가 보이지 않는다.','지금 피자를 먹고 있다.']],
      ['A: “What time is it?” B: “It’s half past four.” 알맞은 시각은?','4시 30분',['4시 정각','3시 30분','5시 30분']],
    ]
  };
  const [q,answer,wrong]=pick(rand,banks[difficulty]||banks.medium);
  return {subject:'영어',difficulty,q,options:makeOptions(rand,answer,wrong),answer};
}

function generateGrade4DailyQuiz(date=quizDateKey()){
  const rand=seededRandom(`grade4-mixed-v3-${date}`);

  // 학생이 난이도를 선택하지 않습니다.
  // 날짜마다 자동으로 난이도를 섞되, 매일 기본·응용·도전 문제가 반드시 모두 포함됩니다.
  // 날짜에 따라 1기본+3응용+1도전 또는 1기본+2응용+2도전 중 하나가 선택됩니다.
  const difficultyPattern=rand()<0.5
    ? ['easy','medium','medium','medium','hard']
    : ['easy','medium','medium','hard','hard'];
  const difficulties=shuffle(rand,difficultyPattern);
  const builders=[
    buildKoreanQuestion,
    buildMathQuestion,
    buildSocialQuestion,
    buildScienceQuestion,
    buildEnglishQuestion,
  ];

  return shuffle(rand,builders.map((builder,i)=>builder(rand,difficulties[i])));
}

const MISSION_LIST = [
  '친구 한 명의 좋은 점을 직접 말해주기',
  '혼자 있는 친구에게 먼저 말을 걸어보기',
  '도움을 받은 친구에게 고맙다고 말하기',
  '친구 이야기를 끊지 않고 끝까지 들어주기',
  '친구가 실수했을 때 괜찮다고 말해주기'
];


const AVATAR_PRESETS = [
  ['daiso01','반짝'],['daiso02','햇살'],['daiso03','콩콩'],['daiso04','두근'],['daiso05','초롱'],
  ['daiso06','포근'],['daiso07','씽씽'],['daiso08','별빛'],['daiso09','말랑'],['daiso10','새싹'],
  ['daiso11','구름'],['daiso12','보라'],['daiso13','토리'],['daiso14','모모'],['daiso15','하늘'],
  ['daiso16','나무'],['daiso17','여울'],['daiso18','단비'],['daiso19','노을'],['daiso20','라온']
];
const AVATAR_SKINS=['f2d3b1','ecad80','d08b5b','ae5d29','614335'];
const AVATAR_HAIRS=['2c1b18','6a3f2b','b4532a','d6a22a','20252f','6b63d9'];
const AVATAR_BACKGROUNDS=['e8f4ff','f5edff','fff3d7','e9f8e8','ffe9ef'];

function avatarUrl(config={}){
  const seed=config.seed||'daiso01';
  const skinColor=config.skinColor||'f2d3b1';
  const hairColor=config.hairColor||'2c1b18';
  const backgroundColor=config.backgroundColor||'e8f4ff';
  return `https://api.dicebear.com/10.x/adventurer/svg?seed=${encodeURIComponent(seed)}&skinColor=${skinColor}&hairColor=${hairColor}&backgroundColor=${backgroundColor}&backgroundType=solid&radius=50`;
}


const DAISO_LOGO_URL=`${import.meta.env.BASE_URL}daiso-logo.png`;

function ClassLogo({onClick,size=44}){
  return <button
    type="button"
    onClick={onClick}
    title="다이소반 로고 크게 보기"
    aria-label="다이소반 로고 크게 보기"
    style={{
      width:size,height:size,border:0,borderRadius:14,padding:3,background:'#fff',
      overflow:'hidden',cursor:'pointer',display:'grid',placeItems:'center',
      boxShadow:'0 0 0 1px rgba(0,0,0,.05)'
    }}
  >
    <img src={DAISO_LOGO_URL} alt="다이소반 로고" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
  </button>;
}

function LogoViewer({onClose}){
  return <div
    role="dialog"
    aria-modal="true"
    aria-label="다이소반 로고 크게 보기"
    onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}
    style={{
      position:'fixed',inset:0,zIndex:9999,background:'rgba(20,20,30,.72)',
      display:'grid',placeItems:'center',padding:24
    }}
  >
    <div style={{
      position:'relative',width:'min(92vw,620px)',maxHeight:'90vh',
      background:'#fff',borderRadius:24,padding:20,display:'grid',placeItems:'center',
      boxShadow:'0 24px 80px rgba(0,0,0,.3)'
    }}>
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        style={{
          position:'absolute',right:12,top:12,width:42,height:42,border:0,
          borderRadius:'50%',background:'#f1eefc',fontSize:26,cursor:'pointer'
        }}
      >×</button>
      <img
        src={DAISO_LOGO_URL}
        alt="다이소반 로고 확대 이미지"
        style={{maxWidth:'100%',maxHeight:'calc(90vh - 40px)',objectFit:'contain',borderRadius:16}}
      />
    </div>
  </div>;
}

function AvatarPicker({value,onClose,onSave}){
  const [draft,setDraft]=useState(value||{seed:'daiso01',skinColor:'f2d3b1',hairColor:'2c1b18',backgroundColor:'e8f4ff'});
  const [saving,setSaving]=useState(false);
  const pickSeed=(seed)=>setDraft(v=>({...v,seed}));
  const save=async()=>{setSaving(true);try{await onSave(draft);onClose();}finally{setSaving(false)}};
  const shuffle=(kind)=>{
    const n=Math.floor(Math.random()*99999);
    setDraft(v=>({...v,seed:`${v.seed.split('-')[0]}-${kind}-${n}`}));
  };
  return <div className="avatar-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="avatar-modal" role="dialog" aria-modal="true" aria-label="내 캐릭터 선택하기">
      <div className="avatar-modal-head"><div><h2>🎨 내 캐릭터 선택하기</h2><p>나를 표현하는 특별한 캐릭터를 골라보세요!</p></div><button className="avatar-close" onClick={onClose}>×</button></div>
      <div className="avatar-modal-body">
        <section className="avatar-preview-panel">
          <div className="avatar-preview-ring"><img src={avatarUrl(draft)} alt="선택한 캐릭터 미리보기"/></div>
          <strong>내 캐릭터</strong><span>언제든지 다시 바꿀 수 있어요.</span>
          <button className="avatar-save" onClick={save} disabled={saving}>{saving?'저장 중...':'이 캐릭터로 저장하기'}</button>
        </section>
        <section className="avatar-editor-panel">
          <div className="avatar-editor-title"><div><b>✨ 추천 캐릭터 20종</b><span>마음에 드는 캐릭터를 골라보세요!</span></div></div>
          <div className="avatar-preset-grid">{AVATAR_PRESETS.map(([seed,name])=><button key={seed} className={(draft.seed||'').startsWith(seed)?'selected':''} onClick={()=>pickSeed(seed)} title={name}><img src={avatarUrl({...draft,seed})} alt={`${name} 캐릭터`}/><small>{name}</small></button>)}</div>
          <div className="avatar-custom-title"><b>직접 꾸미기</b><span>피부색과 머리색을 바꾸고, 스타일을 다시 뽑아보세요.</span></div>
          <div className="avatar-option-row"><strong>피부색</strong><div className="avatar-swatch-row">{AVATAR_SKINS.map(c=><button key={c} className={draft.skinColor===c?'selected':''} style={{'--swatch':`#${c}`}} onClick={()=>setDraft(v=>({...v,skinColor:c}))} aria-label={`피부색 ${c}`}/>)}</div></div>
          <div className="avatar-option-row"><strong>머리 색상</strong><div className="avatar-swatch-row">{AVATAR_HAIRS.map(c=><button key={c} className={draft.hairColor===c?'selected':''} style={{'--swatch':`#${c}`}} onClick={()=>setDraft(v=>({...v,hairColor:c}))} aria-label={`머리색 ${c}`}/>)}</div></div>
          <div className="avatar-option-row"><strong>배경</strong><div className="avatar-swatch-row">{AVATAR_BACKGROUNDS.map(c=><button key={c} className={draft.backgroundColor===c?'selected':''} style={{'--swatch':`#${c}`}} onClick={()=>setDraft(v=>({...v,backgroundColor:c}))} aria-label={`배경색 ${c}`}/>)}</div></div>
          <div className="avatar-reroll-row"><button onClick={()=>shuffle('hair')}>💇 다른 헤어·얼굴 보기</button><button onClick={()=>shuffle('expression')}>😄 다른 표정 보기</button></div>
          <p className="avatar-diversity-note">💡 추천 캐릭터는 피부색·머리 모양·분위기가 다양하게 나오도록 서로 다른 조합을 사용했어요.</p>
        </section>
      </div>
    </div>
  </div>;
}

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
  const [logoOpen,setLogoOpen]=useState(false);

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
      <div style={{display:'flex',justifyContent:'center',marginBottom:12}}><ClassLogo size={84} onClick={()=>setLogoOpen(true)}/></div>
      <h1>행복한 다이소반</h1>
      <p>함께 배려하고, 함께 성장하는 교실</p>
      <button type="button" className="google-login-btn" onClick={googleLogin} disabled={busy}>
        <span className="google-g">G</span>
        {busy?'Google 로그인 중...':'Google 계정으로 로그인'}
      </button>
      <div className="login-help">학생은 자신의 학교 Google 계정으로 로그인하세요.</div>
      {error&&<div className="error-box">{error}</div>}
    </div>
    {logoOpen&&<LogoViewer onClose={()=>setLogoOpen(false)}/>}
  </div>;
}

function localDateKey(){
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function StudentApp({profile}){
  const [page,setPage]=useState('home');
  const [points,setPoints]=useState(profile.points??0);
  const [missionDone,setMissionDone]=useState(false);
  const [avatar,setAvatar]=useState(profile.avatar||{seed:'daiso01',skinColor:'f2d3b1',hairColor:'2c1b18',backgroundColor:'e8f4ff'});
  const [avatarOpen,setAvatarOpen]=useState(false);
  const [logoOpen,setLogoOpen]=useState(false);
  const mission=MISSION_LIST[new Date().getDate()%MISSION_LIST.length];
  const classPoint=useClassPointData();

  useEffect(()=>onSnapshot(doc(db,'users',auth.currentUser.uid),snap=>{if(snap.exists())setPoints(Number(snap.data().points)||0)}),[]);

  // 교사 포인트 조정은 교사 화면에서 학생 users 문서에 즉시 반영합니다.
  // 이전 teacherPointAdjustments 대기열은 더 이상 사용하지 않습니다.

  const addPoints=async (n,reason='포인트 적립')=>{
    const uid=auth.currentUser.uid,userRef=doc(db,'users',uid),txRef=doc(collection(db,'pointTransactions'));
    let next=points;
    await runTransaction(db,async tx=>{
      const snap=await tx.get(userRef);
      const current=Number(snap.data()?.points)||0;
      next=current+n;
      tx.update(userRef,{points:next});
      tx.set(txRef,{uid,amount:n,reason,balanceAfter:next,createdAt:serverTimestamp()});
    });
    setPoints(next);
    return next;
  };
  const spendPoints=async (n,reason='포인트 사용')=>{
    const uid=auth.currentUser.uid,userRef=doc(db,'users',uid),txRef=doc(collection(db,'pointTransactions'));
    let next=points,ok=true;
    await runTransaction(db,async tx=>{
      const snap=await tx.get(userRef);
      const current=Number(snap.data()?.points)||0;
      if(current<n){ok=false;return;}
      next=current-n;
      tx.update(userRef,{points:next});
      tx.set(txRef,{uid,amount:-n,reason,balanceAfter:next,createdAt:serverTimestamp()});
    });
    if(!ok)return false;
    setPoints(next);
    return true;
  };

  const claimQuizReward=async(score)=>{
    const uid=auth.currentUser.uid;
    const date=localDateKey();
    const attemptRef=doc(db,'quizAttempts',`${uid}_${date}`);
    const legacyRewardRef=doc(db,'quizDailyRewards',`${uid}_${date}`);
    const userRef=doc(db,'users',uid);
    const txRef=doc(collection(db,'pointTransactions'));
    let alreadyCompleted=false,awarded=false,next=points;

    await runTransaction(db,async tx=>{
      const [attemptSnap,legacySnap,userSnap]=await Promise.all([
        tx.get(attemptRef),
        tx.get(legacyRewardRef),
        tx.get(userRef)
      ]);

      // 예전 버전에서 오답 응시 기록이 남아 있어도 5/5가 아니면 다시 풀 수 있습니다.
      const attemptPerfect=attemptSnap.exists() && Number(attemptSnap.data()?.score)===5;
      if(attemptPerfect || legacySnap.exists()){
        alreadyCompleted=true;
        return;
      }

      // 5문제를 모두 맞혔을 때만 오늘의 퀴즈를 완료 처리하고 +3P를 지급합니다.
      // 오답이 있으면 아무 기록도 잠그지 않아 바로 다시 풀 수 있습니다.
      if(Number(score)!==5)return;

      const current=Number(userSnap.data()?.points)||0;
      next=current+3;
      tx.set(attemptRef,{
        uid,date,score:5,completed:true,points:3,createdAt:serverTimestamp()
      });
      tx.update(userRef,{points:next});
      tx.set(txRef,{
        uid,amount:3,reason:'퀴즈방 5문제 모두 정답',balanceAfter:next,
        quizDate:date,createdAt:serverTimestamp()
      });
      awarded=true;
    });

    if(awarded)setPoints(next);
    return {alreadyCompleted,awarded,needsRetry:!alreadyCompleted&&!awarded};
  };

  const saveAvatar=async(nextAvatar)=>{
    await updateDoc(doc(db,'users',auth.currentUser.uid),{avatar:nextAvatar});
    setAvatar(nextAvatar);
  };

  useEffect(()=>{
    const today=localDateKey();
    getDoc(doc(db,'missionCompletions',`${auth.currentUser.uid}_${today}`)).then(s=>setMissionDone(s.exists()));
  },[]);

  const finishMission=async()=>{
    if(missionDone)return;
    if(!window.confirm('정말로 미션을 수행하고, 버튼을 눌렀나요?'))return;
    const today=localDateKey();
    await setDoc(doc(db,'missionCompletions',`${auth.currentUser.uid}_${today}`),{
      uid:auth.currentUser.uid,date:today,mission,createdAt:serverTimestamp()
    });
    await addPoints(1,'오늘의 미션 완료');setMissionDone(true);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><ClassLogo size={44} onClick={()=>setLogoOpen(true)}/><div style={{minWidth:0}}><strong style={{whiteSpace:'nowrap',fontSize:17,letterSpacing:'-0.5px'}}>행복한 다이소반</strong><span>4학년 1반</span></div></div>
      <nav>{MENU.map(([key,icon,label])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}>
        <span className="nav-icon">{icon}</span><span>{label}</span>
      </button>)}</nav>
      <div className="profile-card">
        <button className="avatar avatar-button" onClick={()=>setAvatarOpen(true)} title="캐릭터 바꾸기"><img src={avatarUrl(avatar)} alt="내 캐릭터"/></button><div><strong>{profile.name||'학생'}</strong><span className="avatar-change-hint" onClick={()=>setAvatarOpen(true)}>캐릭터 바꾸기</span><button onClick={()=>signOut(auth)}>로그아웃</button></div>
      </div>
    </aside>

    <main className="main-panel">
      <header className="mobile-head"><button className="mobile-avatar-btn" onClick={()=>setAvatarOpen(true)} title="캐릭터 바꾸기"><img src={avatarUrl(avatar)} alt="내 캐릭터"/></button><strong>행복한 다이소반</strong><button onClick={()=>signOut(auth)}>로그아웃</button></header>
      {page==='home'&&<Home profile={profile} points={points} mission={mission} missionDone={missionDone} finishMission={finishMission} go={setPage} classPoint={classPoint}/>}
      {page==='points'&&<PointHistory points={points}/>}
      {page==='classpoints'&&<ClassPoints points={points} setPoints={setPoints} classPoint={classPoint}/>}
      {page==='notifications'&&<Notifications go={setPage}/>}
      {page==='praise'&&<Praise/>}
      {page==='voice'&&<Voice/>}
      {page==='study'&&<Study/>}
      {page==='quiz'&&<Quiz claimReward={claimQuizReward}/>}
      {page==='gallery'&&<Gallery onReward={()=>addPoints(2,'작품전시관 작품 등록')} points={points} setPoints={setPoints}/>}
      {page==='record'&&<Record/>}
      {page==='vote'&&<Vote points={points}/>}
      {page==='coupon'&&<Coupon points={points} spend={spendPoints}/>}
    </main>
    <nav className="bottom-nav">
      {MENU.slice(0,5).map(([key,icon,label])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}><span>{icon}</span><small>{label}</small></button>)}
    </nav>
    {avatarOpen&&<AvatarPicker value={avatar} onClose={()=>setAvatarOpen(false)} onSave={saveAvatar}/>}
    {logoOpen&&<LogoViewer onClose={()=>setLogoOpen(false)}/>}
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
        tx.set(txRef,{uid,amount:-n,reason:'우리 반 포인트 적립',balanceAfter:nextBalance,classPointContributionId:contributionRef.id,classPointRoundId:classPoint.rewardRoundId||1,createdAt:serverTimestamp()});
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
 const [items,setItems]=useState([]),[answers,setAnswers]=useState({}),[results,setResults]=useState({}),[rewarded,setRewarded]=useState({});
 const [openWorksheetId,setOpenWorksheetId]=useState(null);
 useEffect(()=>onSnapshot(collection(db,'worksheets'),x=>setItems(x.docs.map(d=>({id:d.id,...d.data()})).filter(w=>w.published!==false))),[]);
 const norm=v=>(v||'').trim().replace(/\s+/g,' ').replace(/[–—]/g,'-').toLowerCase();
 const grade=async w=>{
   const key=w.answers||[], mine=answers[w.id]||{};
   const detail=key.map(a=>({no:a.no,correct:(a.accepted||[]).map(norm).includes(norm(mine[a.no]))}));
   const correctCount=detail.filter(x=>x.correct).length;
   const threshold=Math.max(1,Math.min(key.length,Number(w.rewardThreshold)||key.length));
   setResults(prev=>({...prev,[w.id]:detail}));

   const uid=auth.currentUser.uid;
   const subRef=doc(db,'worksheetSubmissions',`${w.id}_${uid}`);

   try{
     // 채점 결과는 포인트 지급 여부와 관계없이 먼저 저장합니다.
     await setDoc(subRef,{
       worksheetId:w.id,worksheetTitle:w.title,uid,
       studentName:auth.currentUser.displayName||'학생',
       answers:mine,results:detail,correctCount,total:key.length,
       rewardThreshold:threshold,updatedAt:serverTimestamp()
     },{merge:true});

     if(correctCount<threshold){
       alert(`${key.length}문제 중 ${correctCount}문제 정답!\n${threshold-correctCount}문제만 더 맞히면 +5P!`);
       return;
     }

     // 새 보상 장부를 사용합니다. 한 학생이 같은 문제지에서 딱 한 번만 +5P를 받습니다.
     // 기존 보상 문서가 실제 지급 완료(credited:true)로 남아 있으면 중복 지급하지 않습니다.
     const legacyRef=doc(db,'worksheetRewards',`${w.id}_${uid}`);
     const legacySnap=await getDoc(legacyRef);
     if(legacySnap.exists() && legacySnap.data()?.credited===true){
       setRewarded(prev=>({...prev,[w.id]:true}));
       alert(`${key.length}문제 중 ${correctCount}문제 정답!\n이 문제지는 이미 +5P를 받은 문제지예요.`);
       return;
     }

     const claimRef=doc(db,'worksheetRewardClaims',`${w.id}_${uid}`);
     const userRef=doc(db,'users',uid);
     const txRef=doc(collection(db,'pointTransactions'));
     let awarded=false;
     let nextBalance=0;

     await runTransaction(db,async tx=>{
       const [claimSnap,userSnap]=await Promise.all([tx.get(claimRef),tx.get(userRef)]);
       if(claimSnap.exists()) return;

       const current=Number(userSnap.data()?.points)||0;
       nextBalance=current+5;
       tx.update(userRef,{points:nextBalance});
       tx.set(claimRef,{
         uid,worksheetId:w.id,worksheetTitle:w.title,
         points:5,credited:true,balanceAfter:nextBalance,
         createdAt:serverTimestamp()
       });
       tx.set(txRef,{
         uid,amount:5,worksheetId:w.id,worksheetTitle:w.title,
         reason:`학습방 문제지 보상 · ${w.title}`,
         balanceAfter:nextBalance,createdAt:serverTimestamp()
       });
       awarded=true;
     });

     setRewarded(prev=>({...prev,[w.id]:true}));
     if(awarded){
       await setDoc(subRef,{rewarded5P:true,rewardedAt:serverTimestamp()},{merge:true});
       alert(`${key.length}문제 중 ${correctCount}문제 정답!\n🎉 +5P 적립 완료! 현재 포인트 ${nextBalance}P`);
     }else{
       alert(`${key.length}문제 중 ${correctCount}문제 정답!\n이 문제지는 이미 +5P를 받은 문제지예요.`);
     }
   }catch(err){
     console.error('학습방 채점/포인트 적립 오류',err);
     alert(`채점 또는 포인트 적립에 실패했습니다.\n${err.message||err}`);
   }
 };
 return <><PageHead title="학습방"/><div className="study-motivation"><div className="study-motivation-icon">🔥</div><div><strong>문제집 풀고 포인트 받자!</strong><span>선생님이 정한 목표 문제 수 이상 맞히면 <b>5P 적립!</b></span><small>문제지마다 5P는 딱 한 번만 받을 수 있어요. 이미 보상을 받은 문제지는 다시 풀어도 추가 적립되지 않아요.</small></div></div><div className="study-help">📌 풀 문제지를 선택하면 정답 입력칸이 열려요. 한 번에 하나의 문제지만 펼쳐집니다.</div><div className="list-stack">{items.length?items.map(w=>{const key=w.answers||[],graded=results[w.id]||[],threshold=Math.max(1,Math.min(key.length||1,Number(w.rewardThreshold)||key.length||1));const isOpen=openWorksheetId===w.id;const done=!!rewarded[w.id];return <div className={`worksheet-card ${isOpen?'open':''}`} key={w.id}><button type="button" className="worksheet-accordion-head" onClick={()=>setOpenWorksheetId(isOpen?null:w.id)} style={{width:'100%',border:0,background:'transparent',padding:0,textAlign:'left',cursor:'pointer'}}><div className="worksheet-head"><div className="file-icon">{done?'✅':'📄'}</div><div className="grow"><strong>{w.title}</strong><span>{key.length||w.questionCount||0}문제 · 자동 채점 {done?'· +5P 적립 완료':''}</span></div><span style={{fontWeight:900,fontSize:22,color:'#6d4aff'}}>{isOpen?'⌃':'⌄'}</span></div><div className="worksheet-reward-banner">🎯 <b>{threshold}문제 이상 정답이면 +5P</b><span>{done?' · 보상 획득 완료 ✓':''}</span></div></button>{isOpen&&<div className="worksheet-accordion-body">{w.pdfUrl&&<div style={{display:'flex',justifyContent:'flex-end',margin:'12px 0'}}><a className="outline-btn" href={w.pdfUrl} target="_blank" rel="noreferrer">PDF 열기</a></div>}<div className="student-answer-grid">{key.map(a=>{const r=graded.find(x=>x.no===a.no);return <label className={`student-answer-item ${r?r.correct?'correct':'wrong':''}`} key={a.no}><span>{a.no}번</span><input value={(answers[w.id]||{})[a.no]||''} onChange={e=>setAnswers({...answers,[w.id]:{...(answers[w.id]||{}),[a.no]:e.target.value}})} placeholder="정답 입력"/><i>{r?(r.correct?'✓ 정답':'✕ 오답'):''}</i></label>})}</div><button className="primary-wide" disabled={!key.length} onClick={()=>grade(w)}>전체 채점하기</button>{done&&<div style={{marginTop:10,textAlign:'center',fontWeight:800,color:'#6b7280'}}>✅ 이 문제지의 +5P는 이미 적립되었습니다. 다시 풀어도 포인트는 추가되지 않아요.</div>}</div>}</div>}):<Empty text="선생님이 올린 학습지가 아직 없어요."/>}</div></>;
}

function Quiz({claimReward}){
  const [idx,setIdx]=useState(0);
  const [selected,setSelected]=useState({});
  const [completedToday,setCompletedToday]=useState(null);
  const [todayResult,setTodayResult]=useState(null);
  const [quiz,setQuiz]=useState(null);
  const [quizError,setQuizError]=useState('');
  const date=quizDateKey();

  useEffect(()=>{
    let alive=true;
    const uid=auth.currentUser.uid;
    const attemptRef=doc(db,'quizAttempts',`${uid}_${date}`);
    const legacyRef=doc(db,'quizDailyRewards',`${uid}_${date}`);
    const quizSetId=`v3_${date}`;
    const setRef=doc(db,'dailyQuizSets',quizSetId);

    // 1) 날짜별 퀴즈 세트를 Firestore에서 불러옵니다.
    //    오늘 세트가 아직 없다면 4학년용 새 5문제를 만들어 그 날짜 문서에 고정 저장합니다.
    (async()=>{
      try{
        const snap=await getDoc(setRef);
        if(!alive)return;
        if(snap.exists() && Array.isArray(snap.data()?.questions) && snap.data().questions.length===5){
          setQuiz(snap.data().questions);
        }else{
          const generated=generateGrade4DailyQuiz(date);
          await setDoc(setRef,{
            date:quizSetId,
            calendarDate:date,
            version:3,
            grade:4,
            subjects:['국어','수학','사회','과학','영어'],
            difficultyMix:true,
            questions:generated,
            createdAt:serverTimestamp()
          });
          if(alive)setQuiz(generated);
        }
      }catch(err){
        console.error('오늘의 퀴즈 세트 불러오기/생성 오류',err);
        // Firestore 저장이 일시적으로 실패해도 오늘 날짜 기반 문제는 화면에 보여 줍니다.
        // 같은 날짜에는 같은 문제, 날짜가 바뀌면 새로운 문제가 만들어집니다.
        if(alive){
          setQuiz(generateGrade4DailyQuiz(date));
          setQuizError('오늘의 퀴즈 세트 저장을 확인하지 못했어요.');
        }
      }
    })();

    // 2) 오늘 응시 완료 여부를 실시간 확인합니다.
    getDoc(legacyRef).then(snap=>{
      if(!alive)return;
      if(snap.exists()){
        setCompletedToday(true);
        setTodayResult(snap.data());
      }
    }).catch(err=>console.error('기존 퀴즈 기록 확인 오류',err));

    const unsub=onSnapshot(attemptRef,snap=>{
      if(!alive)return;
      if(snap.exists() && Number(snap.data()?.score)===5){
        setCompletedToday(true);
        setTodayResult(snap.data());
      }else{
        getDoc(legacyRef).then(oldSnap=>{
          if(!alive)return;
          if(oldSnap.exists()){
            setCompletedToday(true);
            setTodayResult(oldSnap.data());
          }else{
            setCompletedToday(false);
            setTodayResult(null);
          }
        }).catch(err=>{
          console.error('퀴즈 응시 여부 확인 오류',err);
          if(alive)setCompletedToday(false);
        });
      }
    },err=>{
      console.error('오늘의 퀴즈 완료 여부 실시간 확인 오류',err);
      // 권한 오류가 생겼다고 재응시를 허용하지 않습니다.
      // 확인 실패 상태로 두어 중복 포인트 지급 가능성을 막습니다.
      if(alive){
        setCompletedToday(null);
        setQuizError('오늘의 응시 기록을 확인하지 못했어요. 새로고침 후 다시 시도해주세요.');
      }
    });

    return()=>{alive=false;unsub();};
  },[date]);

  const finish=async()=>{
    if(!quiz || quiz.length!==5)return alert('오늘의 퀴즈를 불러오는 중이에요. 잠시 후 다시 눌러주세요.');
    if(Object.keys(selected).length<quiz.length)return alert('5문제를 모두 풀어야 채점할 수 있어요.');
    const wrongIndexes=quiz.map((x,i)=>selected[i]===x.answer?null:i).filter(i=>i!==null);
    const score=5-wrongIndexes.length;
    try{
      const result=await claimReward(score);
      if(result.alreadyCompleted){
        setCompletedToday(true);
        return alert('오늘의 퀴즈는 이미 5문제를 모두 맞혔어요. 내일 다시 도전해요 😊');
      }
      if(result.awarded){
        setCompletedToday(true);
        setTodayResult({score:5,points:3,date});
        return alert('오늘의 퀴즈 5/5 정답! +3P 적립 🎉\n오늘의 퀴즈를 완료했어요.');
      }

      // 맞힌 답은 그대로 두고, 틀린 문제의 선택만 지워 다시 풀게 합니다.
      const keepCorrect={...selected};
      wrongIndexes.forEach(i=>delete keepCorrect[i]);
      setSelected(keepCorrect);
      setIdx(wrongIndexes[0]??0);
      alert(`${score}/5 정답이에요.\n틀린 ${wrongIndexes.length}문제만 다시 풀어보세요 😊\n5문제를 모두 맞히면 +3P가 적립돼요.`);
    }catch(err){
      console.error('퀴즈 완료/포인트 적립 오류',err);
      alert(`퀴즈 처리에 실패했습니다.\n${err.message||err}`);
    }
  };

  if(completedToday===null || !quiz)return <><PageHead title="퀴즈방"/><div className="empty-card">오늘의 4학년 퀴즈를 준비하고 있어요...</div>{quizError&&<div className="warning-box">⚠️ {quizError}</div>}</>;

  if(completedToday)return <><PageHead title="퀴즈방"/><div className="quiz-reward-banner">🏆 <b>오늘의 퀴즈를 이미 완료했어요!</b><span>{todayResult?.score!=null?`${todayResult.score}/5 정답${Number(todayResult.points)===3?' · +3P 획득 ✓':''}`:'오늘의 응시 완료 ✓'}</span></div><div className="empty-card"><b>오늘의 5문제를 모두 맞혀 완료했어요.</b><br/>내일은 새로운 4학년 퀴즈 5문제가 열려요 😊</div></>;

  const q=quiz[idx];
  return <><PageHead title="퀴즈방"/><div className="quiz-reward-banner">🏆 <b>틀리면 다시 도전! 5문제를 모두 맞히면 +3P</b><span>매일 국어·수학·사회·과학·영어에서 난이도가 섞인 새로운 5문제가 나와요.</span></div>{quizError&&<div className="warning-box">⚠️ {quizError}</div>}<div className="warning-box">⚠️ <b>친구에게 정답을 알려주지 않습니다.</b></div><div className="quiz-meta"><strong>4학년 오늘의 교과 퀴즈 · {date}</strong><span>{idx+1} / 5</span></div><div className="quiz-card"><span className="subject-pill">{q.subject}</span><h2>{q.q}</h2>{q.options.map(o=><label className={`quiz-option ${selected[idx]===o?'selected':''}`} key={o}><input type="radio" checked={selected[idx]===o} onChange={()=>setSelected({...selected,[idx]:o})}/>{o}</label>)}</div><button className="primary-wide" onClick={()=>idx<4?setIdx(idx+1):finish()}>{idx<4?'다음 문제':'채점하기'}</button></>;
}

function Gallery({onReward,points,setPoints}){
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
    if(!window.confirm(`'${a.title}' 작품을 삭제할까요?\n작품 등록으로 받은 2P도 함께 회수됩니다.`))return;
    const uid=auth.currentUser.uid,userRef=doc(db,'users',uid),artRef=doc(db,'artworks',a.id),txRef=doc(collection(db,'pointTransactions'));
    let nextPoints=points;
    await runTransaction(db,async tx=>{
      const [userSnap,artSnap]=await Promise.all([tx.get(userRef),tx.get(artRef)]);
      if(!artSnap.exists())return;
      const current=Number(userSnap.data()?.points)||0;nextPoints=current-2;
      tx.delete(artRef);
      tx.update(userRef,{points:nextPoints});
      tx.set(txRef,{uid,amount:-2,reason:`작품 삭제 · ${a.title||'작품'}`,balanceAfter:nextPoints,createdAt:serverTimestamp()});
    });
    setPoints(nextPoints);
    alert('작품을 삭제하고 등록 포인트 2P를 회수했습니다.');
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
  const [logoOpen,setLogoOpen]=useState(false);
  return <div className="teacher-shell"><header><div style={{display:'flex',alignItems:'center',gap:12}}><ClassLogo size={48} onClick={()=>setLogoOpen(true)}/><div><h1>행복한 다이소반 · 교사 관리자</h1><p>{profile.name||'선생님'} · 4학년 1반</p></div></div><button onClick={()=>signOut(auth)}>로그아웃</button></header><div className="teacher-tabs"><button className={tab==='study'?'active':''} onClick={()=>setTab('study')}>학습방 관리</button><button className={tab==='content'?'active':''} onClick={()=>setTab('content')}>🧰 게시물 관리</button><button className={tab==='points'?'active':''} onClick={()=>setTab('points')}>💰 개인 포인트</button><button className={tab==='classpoints'?'active':''} onClick={()=>setTab('classpoints')}>🏫 학급 포인트</button><button className={tab==='vote'?'active':''} onClick={()=>setTab('vote')}>투표 관리</button><button className={tab==='coupon'?'active':''} onClick={()=>setTab('coupon')}>쿠폰 건의함</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>⚙️ 앱 설정</button></div>{tab==='study'&&<TeacherStudy/>}{tab==='content'&&<TeacherContentManager/>}{tab==='points'&&<TeacherPointManager/>}{tab==='classpoints'&&<TeacherClassPoints/>}{tab==='vote'&&<TeacherVote/>}{tab==='coupon'&&<TeacherSuggestions/>}{tab==='settings'&&<TeacherSettings/>}{logoOpen&&<LogoViewer onClose={()=>setLogoOpen(false)}/>}</div>
}

function useDriveUrl(){
  const [driveUrl,setDriveUrl]=useState('');
  useEffect(()=>onSnapshot(doc(db,'classSettings','main'),s=>setDriveUrl(s.exists()?(s.data().driveFolderUrl||''):'')),[]);
  return driveUrl;
}

function TeacherStudy(){
 const [title,setTitle]=useState(''),[pdfUrl,setPdfUrl]=useState(''),[count,setCount]=useState(0),[rows,setRows]=useState([]),[rewardThreshold,setRewardThreshold]=useState(''),[busy,setBusy]=useState(false),[items,setItems]=useState([]),[subs,setSubs]=useState([]),[editingId,setEditingId]=useState(''),[quickAnswers,setQuickAnswers]=useState('');const driveUrl=useDriveUrl();
 useEffect(()=>{const a=onSnapshot(collection(db,'worksheets'),x=>setItems(x.docs.map(d=>({id:d.id,...d.data()}))));const b=onSnapshot(collection(db,'worksheetSubmissions'),x=>setSubs(x.docs.map(d=>({id:d.id,...d.data()}))));return()=>{a();b()}},[]);
 const resize=n=>{n=Math.max(1,Math.min(100,Number(n)||1));setCount(n);setRows(old=>Array.from({length:n},(_,i)=>old[i]||{no:i+1,text:''}).map((x,i)=>({...x,no:i+1})));setRewardThreshold(v=>String(Math.min(Number(v)||Math.ceil(n*.8),n)))};
 const detect=async file=>{if(!file)return;setBusy(true);try{const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let text='';for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),c=await page.getTextContent();text+=' '+c.items.map(x=>x.str).join(' ')}const nums=[...text.matchAll(/(?:^|\s)(\d{1,2})[.)번]\s/g)].map(m=>+m[1]).filter(n=>n>0&&n<=100);const u=[...new Set(nums)].sort((a,b)=>a-b);let n=0;for(let i=1;i<=100;i++){if(u.includes(i))n=i;else if(n)break}resize(n||Math.max(1,...u));alert(n?`${n}개 문항을 찾았어요. 문제 수가 맞는지 확인해주세요.`:'문항 번호를 찾지 못했어요. 문제 수를 직접 입력해주세요.')}catch(e){console.error(e);resize(count||1);alert('자동 인식에 실패했어요. 문제 수를 직접 입력해주세요.')}finally{setBusy(false)}};
 const normalizeQuick=x=>x.trim().replace(/^\s*\d{1,3}\s*(?:번|[.)、:\-])\s*/,'').replace(/\s*\|\s*/g,' | ').replace(/\s*\/\s*/g,'/').trim();
 const fillQuickAnswers=()=>{
   const raw=quickAnswers.trim();if(!raw)return alert('정답을 먼저 붙여넣어 주세요.');
   let parts=raw.includes('\n')?raw.split(/\n+/):raw.split(/\s*[,;]\s*/);
   parts=parts.map(normalizeQuick).filter(Boolean);
   if(!parts.length)return alert('정답을 찾지 못했어요. 정답 사이를 줄바꿈이나 쉼표로 구분해주세요.');
   const n=Math.max(count||0,parts.length);setCount(n);setRows(Array.from({length:n},(_,i)=>({no:i+1,text:parts[i]??rows[i]?.text??''})));setRewardThreshold(v=>v||String(Math.ceil(n*.8)));
   alert(`${parts.length}개 정답을 자동으로 채웠어요. 아래에서 한 번 확인해주세요.`);
 };
 const clearForm=()=>{setTitle('');setPdfUrl('');setCount(0);setRows([]);setRewardThreshold('');setEditingId('');setQuickAnswers('')};
 const submit=async e=>{e.preventDefault();const answers=rows.map(r=>({no:r.no,accepted:r.text.split('|').map(x=>x.trim()).filter(Boolean)}));if(answers.some(a=>!a.accepted.length))return alert('빈 정답이 있어요. 아래 정답 입력칸을 확인해주세요.');const threshold=Math.max(1,Math.min(answers.length,Number(rewardThreshold)||answers.length));const data={title,pdfUrl,questionCount:answers.length,answers,rewardThreshold:threshold,rewardPoints:5,published:true,updatedAt:serverTimestamp()};if(editingId){await updateDoc(doc(db,'worksheets',editingId),data);alert('문제지를 수정했습니다.')}else{await addDoc(collection(db,'worksheets'),{...data,createdAt:serverTimestamp()});alert('등록 완료! 학생 학습방에 바로 나타납니다.')}clearForm()};
 const editWorksheet=w=>{setEditingId(w.id);setTitle(w.title||'');setPdfUrl(w.pdfUrl||'');const a=(w.answers||[]).map(x=>({no:x.no,text:(x.accepted||[]).join(' | ')}));setCount(w.questionCount||a.length||1);setRows(a.length?a:Array.from({length:w.questionCount||1},(_,i)=>({no:i+1,text:''})));setRewardThreshold(String(w.rewardThreshold||w.questionCount||a.length||1));setQuickAnswers('');window.scrollTo({top:0,behavior:'smooth'})};
 const removeWorksheet=async w=>{if(!window.confirm(`'${w.title}' 문제지를 삭제할까요?`))return;await deleteDoc(doc(db,'worksheets',w.id));if(editingId===w.id)clearForm()};
 return <div className="teacher-study-wrap"><div className="teacher-card"><h2>📚 {editingId?'문제지 수정':'문제지 추가'}</h2><p className="muted-note">문제지 PDF 링크를 등록하고, 정답은 한 번에 붙여넣으면 1번부터 자동으로 채워집니다.</p>{driveUrl&&<a className="drive-open-btn inline-drive" href={driveUrl} target="_blank" rel="noreferrer">📁 우리 반 공유 드라이브 열기</a>}<form className="form-stack" onSubmit={submit}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="학습지 제목" required/><input type="url" value={pdfUrl} onChange={e=>setPdfUrl(e.target.value)} placeholder="PDF 공유 링크" required/><div className="pdf-detect-box"><b>① 문제지 PDF · 문제 수 자동 인식</b><input type="file" accept="application/pdf" onChange={e=>detect(e.target.files?.[0])}/><small>{busy?'PDF 분석 중...':'선택한 파일은 Firebase에 저장되지 않아요. 문제 수가 다르면 아래에서 직접 바꿀 수 있어요.'}</small></div><div className="ocr-answer-box"><div><b>② 정답 빠른 입력</b><span>답안을 쉼표 또는 줄바꿈으로 구분해 한 번에 붙여넣으세요.</span></div><textarea value={quickAnswers} onChange={e=>setQuickAnswers(e.target.value)} placeholder={'예) 3/5, 5/6, 4/7, 9/15|3/5, 14/23\n\n또는\n3/5\n5/6\n4/7\n9/15|3/5'}/><button type="button" className="light-action" onClick={fillQuickAnswers}>✨ 1번부터 자동 채우기</button><small>복수 정답은 <b>|</b> 로 구분하세요. 예: <b>9/15|3/5</b> · 번호까지 붙여넣어도 됩니다. 예: <b>1. 3/5</b></small></div><div className="teacher-study-settings"><label className="count-field"><span>③ 문제 수</span><input type="number" min="1" max="100" value={count||''} onChange={e=>resize(e.target.value)} required/></label><label className="count-field reward-threshold-field"><span>🎁 5P 획득 기준</span><input type="number" min="1" max={count||100} value={rewardThreshold} onChange={e=>setRewardThreshold(e.target.value)} required/><small>{rewardThreshold?`${rewardThreshold}문제 이상 정답이면 학생에게 5P를 한 번 적립합니다.`:'교사가 기준 문제 수를 정해주세요.'}</small></label></div>{rows.length>0&&<div className="answer-key-editor"><div className="answer-key-title"><b>④ 정답 확인 · 수정</b><span>복수 정답은 | 로 구분</span></div>{rows.map((r,i)=><label key={r.no}><b>{r.no}번</b><input value={r.text} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,text:e.target.value}:x))} placeholder={`${r.no}번 정답`} required/></label>)}</div>}<div className="teacher-form-actions"><button className="teacher-publish-btn" disabled={busy||!rows.length}>{editingId?'문제지 수정 저장':'학생에게 문제지 등록하기'}</button>{editingId&&<button type="button" className="light-action" onClick={clearForm}>수정 취소</button>}</div></form></div><div className="teacher-card"><div className="teacher-section-head"><div><h2>📄 등록된 문제지</h2><p>수정·삭제와 학생 제출 결과를 한 곳에서 관리합니다.</p></div><span className="live-badge">● 실시간</span></div>{items.map(w=>{const ss=subs.filter(s=>s.worksheetId===w.id);return <div className="teacher-worksheet-item" key={w.id}><div><b>{w.title}</b><span>{w.questionCount||0}문제 · 5P 기준 {w.rewardThreshold||w.questionCount||0}문제 · 제출 {ss.length}명</span></div><div className="admin-actions">{w.pdfUrl&&<a href={w.pdfUrl} target="_blank" rel="noreferrer">PDF 보기</a>}<button onClick={()=>editWorksheet(w)}>수정</button><button className="danger-btn" onClick={()=>removeWorksheet(w)}>삭제</button></div></div>})}</div></div>;
}

function TeacherContentManager(){
  const groups=[
    {key:'praises',title:'💌 칭찬함',fields:['toName','text'],label:x=>`${x.toName||'친구'} · ${x.text||''}`},
    {key:'voices',title:'📮 불편의 소리',fields:['text'],label:x=>`${x.anonymous?'익명':'학생'} · ${x.text||''}`},
    {key:'artworks',title:'🎨 작품전시관',fields:['title','link'],label:x=>`${x.title||'작품'} · ${x.link||''}`},
    {key:'selfCompliments',title:'🌱 나의 기록',fields:['text'],label:x=>`${x.date||''} · ${x.text||''}`},
    {key:'couponPurchases',title:'🎟️ 쿠폰 구매 요청',fields:['status'],label:x=>`${x.name||'쿠폰'} · ${x.price||0}P · ${x.status||''}`},
  ];
  const [active,setActive]=useState('praises'),[items,setItems]=useState([]),[loading,setLoading]=useState(true),[users,setUsers]=useState([]);
  const group=groups.find(g=>g.key===active)||groups[0];
  useEffect(()=>onSnapshot(collection(db,'users'),snap=>setUsers(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);
  useEffect(()=>{setLoading(true);const q=query(collection(db,active),orderBy('createdAt','desc'));return onSnapshot(q,s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)},()=>{onSnapshot(collection(db,active),s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false)})})},[active]);
  const getAuthor=x=>{
    if(x.uid===auth.currentUser.uid)return {name:'선생님',email:auth.currentUser.email||''};
    const u=users.find(v=>v.id===x.uid);
    return {name:u?.name||u?.displayName||x.studentName||x.name||u?.email||'학생',email:u?.email||''};
  };
  const editItem=async item=>{
    const patch={};
    for(const f of group.fields){const next=window.prompt(`${f==='text'?'내용':f==='title'?'제목':f==='link'?'링크':f==='toName'?'칭찬할 친구':f==='status'?'상태':f} 수정`,item[f]??'');if(next===null)return;patch[f]=next.trim();}
    await updateDoc(doc(db,active,item.id),patch);alert('수정했습니다.');
  };
  const removeItem=async item=>{
    if(!window.confirm(active==='artworks'?'이 작품을 삭제할까요? 작품 등록으로 지급된 2P도 함께 회수됩니다.':'이 게시물을 삭제할까요?'))return;
    if(active==='artworks'&&item.uid){
      const userRef=doc(db,'users',item.uid),artRef=doc(db,'artworks',item.id),txRef=doc(collection(db,'pointTransactions'));
      await runTransaction(db,async tx=>{
        const [userSnap,artSnap]=await Promise.all([tx.get(userRef),tx.get(artRef)]);
        if(!artSnap.exists())return;
        const current=Number(userSnap.data()?.points)||0,next=current-2;
        tx.delete(artRef);tx.update(userRef,{points:next});
        tx.set(txRef,{uid:item.uid,amount:-2,reason:`교사 작품 삭제 · ${item.title||'작품'}`,balanceAfter:next,createdAt:serverTimestamp(),adjustedBy:auth.currentUser.uid});
      });
    }else await deleteDoc(doc(db,active,item.id));
  };
  const addItem=async()=>{
    const base={uid:auth.currentUser.uid,studentName:'선생님',createdAt:serverTimestamp()};
    if(active==='praises'){const toName=prompt('칭찬할 친구 이름');if(!toName)return;const text=prompt('칭찬 내용');if(!text)return;await addDoc(collection(db,active),{...base,toName,text,status:'new'})}
    else if(active==='voices'){const text=prompt('등록할 의견/안내 내용');if(!text)return;await addDoc(collection(db,active),{...base,text,anonymous:false,status:'new'})}
    else if(active==='artworks'){const title=prompt('작품 제목');if(!title)return;const link=prompt('작품 공유 링크');if(!link)return;await addDoc(collection(db,active),{...base,title,link,sourceType:'link'})}
    else if(active==='selfCompliments'){const text=prompt('기록 내용');if(!text)return;await addDoc(collection(db,active),{...base,text,date:new Date().toISOString().slice(0,10)})}
    else return alert('쿠폰 구매 요청은 학생이 구매할 때 생성됩니다.');
    alert('추가했습니다.');
  };
  return <div className="teacher-card"><div className="teacher-section-head"><div><h2>🧰 게시물 통합 관리</h2><p>학생 화면의 익명 여부와 관계없이 교사는 작성자를 확인할 수 있습니다.</p></div><button className="primary-action" onClick={addItem}>+ 새 게시물</button></div><div className="admin-subtabs">{groups.map(g=><button key={g.key} className={active===g.key?'active':''} onClick={()=>setActive(g.key)}>{g.title}</button>)}</div>{loading?<div className="empty-card">불러오는 중...</div>:items.length?<div className="teacher-suggestion-list">{items.map(x=>{const author=getAuthor(x);return <div className="teacher-suggestion-item" key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{author.name}</strong>{x.anonymous&&<span style={{fontWeight:800,color:'#7c3aed'}}>학생 화면: 익명</span>}<span>{formatCreatedAt(x.createdAt)}</span></div>{author.email&&<div style={{fontSize:12,color:'#9ca3af',marginTop:2}}>작성자 계정: {author.email}</div>}<p>{group.label(x)}</p></div><div className="admin-actions"><button className="small-action" onClick={()=>editItem(x)}>수정</button><button className="danger-btn" onClick={()=>removeItem(x)}>삭제</button></div></div>})}</div>:<Empty text="등록된 게시물이 없어요."/>}</div>
}

function TeacherPointManager(){
  const [users,setUsers]=useState([]),[transactions,setTransactions]=useState([]),[selectedUid,setSelectedUid]=useState('');
  useEffect(()=>{const a=onSnapshot(collection(db,'users'),snap=>setUsers(snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.role!=='teacher').sort((a,b)=>(a.name||a.email||'').localeCompare(b.name||b.email||'','ko'))));const b=onSnapshot(collection(db,'pointTransactions'),snap=>{const rows=snap.docs.map(d=>({id:d.id,...d.data()}));rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));setTransactions(rows)});return()=>{a();b()}},[]);
  const applyTeacherPointChange=async(u,amount,reason,extra={})=>{
    const userRef=doc(db,'users',u.id);
    const logRef=doc(collection(db,'pointTransactions'));
    let before=0,next=0,applied=0;
    await runTransaction(db,async tx=>{
      const userSnap=await tx.get(userRef);
      if(!userSnap.exists())throw new Error('학생 계정 문서를 찾을 수 없습니다.');
      before=Number(userSnap.data().points)||0;
      next=Math.max(0,before+Number(amount));
      applied=next-before;
      tx.update(userRef,{points:next});
      tx.set(logRef,{uid:u.id,amount:applied,reason,balanceAfter:next,createdAt:serverTimestamp(),adjustedBy:auth.currentUser.uid,...extra});
    });
    return {before,next,applied};
  };
  const requestAdjustment=async(u,kind)=>{
    const label=u.name||u.email||'학생';
    const raw=window.prompt(`${label}에게 ${kind==='add'?'적립':'차감'}할 포인트를 입력하세요.\n(양수만 입력)`, '1');
    if(raw===null)return;
    const n=Math.max(0,Math.trunc(Number(raw)||0));
    if(!n)return alert('1P 이상 입력해주세요.');
    const reason=window.prompt('조정 사유를 입력해주세요.',kind==='add'?'교사 포인트 적립':'교사 포인트 차감');
    if(reason===null||!reason.trim())return;
    try{
      const result=await applyTeacherPointChange(u,kind==='add'?n:-n,reason.trim());
      alert(`${label} 포인트를 ${result.before}P → ${result.next}P로 바로 반영했습니다.`);
    }catch(err){
      console.error('교사 포인트 조정 오류',err);
      alert(`포인트 ${kind==='add'?'적립':'차감'}에 실패했습니다.\n${err.message||err}`);
    }
  };
  const reverse=async t=>{
    if(!t.amount)return;
    const isClassPointContribution=t.reason==='우리 반 포인트 적립';
    const extraNotice=isClassPointContribution?'\n우리 반 포인트에서도 같은 만큼 차감됩니다.':'';
    if(!window.confirm(`이 내역을 반대로 조정할까요?\n${t.amount>0?'+':''}${t.amount}P → ${-t.amount>0?'+':''}${-t.amount}P${extraNotice}`))return;
    const u=users.find(x=>x.id===t.uid);
    if(!u)return alert('해당 학생 계정을 찾을 수 없습니다.');
    try{
      if(isClassPointContribution){
        const userRef=doc(db,'users',u.id);
        const logRef=doc(collection(db,'pointTransactions'));
        const classRef=doc(collection(db,'classPointContributions'));
        const settingsRef=doc(db,'classSettings','main');
        let before=0,next=0,applied=0,classDeduct=0;
        await runTransaction(db,async tx=>{
          const [userSnap,settingsSnap]=await Promise.all([tx.get(userRef),tx.get(settingsRef)]);
          if(!userSnap.exists())throw new Error('학생 계정 문서를 찾을 수 없습니다.');
          before=Number(userSnap.data().points)||0;
          const refund=Math.abs(Number(t.amount)||0);
          next=before+refund;
          applied=refund;
          classDeduct=-refund;
          const roundId=Number(t.classPointRoundId)||Number(settingsSnap.data()?.rewardRoundId)||1;
          tx.update(userRef,{points:next});
          tx.set(logRef,{uid:u.id,amount:applied,reason:`교사 내역 취소 · ${t.reason||'포인트 내역'}`,balanceAfter:next,createdAt:serverTimestamp(),adjustedBy:auth.currentUser.uid,reversesTransactionId:t.id});
          tx.set(classRef,{uid:u.id,studentName:u.name||u.email||'학생',amount:classDeduct,roundId,reason:'우리 반 포인트 적립 취소',type:'teacherContributionReversal',reversesTransactionId:t.id,createdAt:serverTimestamp(),adjustedBy:auth.currentUser.uid});
        });
        alert(`${u.name||u.email||'학생'}에게 ${applied}P를 반환하고, 우리 반 포인트에서도 ${Math.abs(classDeduct)}P를 차감했습니다.`);
      }else{
        const result=await applyTeacherPointChange(u,-Number(t.amount),`교사 내역 취소 · ${t.reason||'포인트 내역'}`,{reversesTransactionId:t.id});
        alert(`${u.name||u.email||'학생'} 포인트를 ${result.before}P → ${result.next}P로 바로 반영했습니다.`);
      }
    }catch(err){console.error('내역 취소 오류',err);alert(`내역 취소에 실패했습니다.\n${err.message||err}`);}
  };
  const filtered=selectedUid?transactions.filter(t=>t.uid===selectedUid):transactions;
  return <div className="teacher-classpoint-grid"><div className="teacher-card"><div className="teacher-section-head"><div><h2>💰 학생 개인 포인트 관리</h2><p>적립과 차감을 누르면 학생의 실제 포인트에 즉시 반영됩니다.</p></div><span className="live-badge">● 실시간</span></div><div className="point-student-grid">{users.map(u=><div className="point-student-card" key={u.id}><div><strong>{u.name||u.email||'학생'}</strong><span>{Number(u.points||0)}P</span></div><div className="admin-actions"><button className="small-action" onClick={()=>requestAdjustment(u,'add')}>＋ 적립</button><button className="danger-btn" onClick={()=>requestAdjustment(u,'deduct')}>－ 차감</button></div></div>)}</div></div><div className="teacher-card"><div className="teacher-section-head"><div><h2>🧾 포인트 내역</h2><p>잘못된 내역은 삭제하지 않고 반대 금액을 새로 반영합니다.</p></div><select value={selectedUid} onChange={e=>setSelectedUid(e.target.value)}><option value="">전체 학생</option>{users.map(u=><option key={u.id} value={u.id}>{u.name||u.email||'학생'}</option>)}</select></div>{filtered.length?<div className="teacher-suggestion-list">{filtered.slice(0,200).map(t=>{const u=users.find(x=>x.id===t.uid);return <div className="teacher-suggestion-item" key={t.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{u?.name||u?.email||t.uid||'학생'}</strong><span>{formatCreatedAt(t.createdAt)}</span></div><p>{t.reason||'포인트 내역'} · 잔액 {Number(t.balanceAfter||0)}P</p></div><div className="point-history-admin"><b className={Number(t.amount)>=0?'plus':'minus'}>{Number(t.amount)>0?'+':''}{Number(t.amount)}P</b><button className="small-action" onClick={()=>reverse(t)}>이 내역 취소</button></div></div>})}</div>:<Empty text="포인트 내역이 없어요."/>}</div></div>;
}

function TeacherClassPoints(){
  const classPoint=useClassPointData();
  const [goal,setGoal]=useState('3000');
  const [candidates,setCandidates]=useState([]);
  const [candidateText,setCandidateText]=useState('');
  const [votes,setVotes]=useState([]);
  const [addAmount,setAddAmount]=useState('');const [addReason,setAddReason]=useState('');
  const [deductAmount,setDeductAmount]=useState('');const [deductReason,setDeductReason]=useState('');
  useEffect(()=>{setGoal(String(classPoint.goal||3000));setCandidates(classPoint.rewardCandidates||[])},[classPoint.goal,JSON.stringify(classPoint.rewardCandidates)]);
  useEffect(()=>onSnapshot(query(collection(db,'classRewardVotes'),where('roundId','==',classPoint.rewardRoundId||1)),snap=>setVotes(snap.docs.map(d=>({id:d.id,...d.data()})))),[classPoint.rewardRoundId]);
  const addClassPoints=async()=>{const n=Math.max(0,Math.floor(Number(addAmount)||0));if(!n)return alert('추가할 포인트를 입력해주세요.');if(!addReason.trim())return alert('추가 사유를 입력해주세요.');try{await addDoc(collection(db,'classPointContributions'),{uid:auth.currentUser.uid,studentName:'선생님',amount:n,roundId:classPoint.rewardRoundId||1,reason:addReason.trim(),type:'teacherAddition',createdAt:serverTimestamp()});setAddAmount('');setAddReason('');alert(`${n}P 추가했습니다.`)}catch(err){console.error('학급 포인트 추가 오류',err);alert(`학급 포인트 추가에 실패했습니다.\n${err.message||err}`)}};
  const deductClassPoints=async()=>{const n=Math.max(0,Math.floor(Number(deductAmount)||0));if(!n)return alert('차감할 포인트를 입력해주세요.');if(n>classPoint.total)return alert('현재 학급 포인트보다 많이 차감할 수 없어요.');if(!deductReason.trim())return alert('차감 사유를 입력해주세요.');if(!window.confirm(`학급 전체 포인트에서 ${n}P를 차감할까요?`))return;try{await addDoc(collection(db,'classPointContributions'),{uid:auth.currentUser.uid,studentName:'선생님',amount:-n,roundId:classPoint.rewardRoundId||1,reason:deductReason.trim(),type:'teacherDeduction',createdAt:serverTimestamp()});setDeductAmount('');setDeductReason('');alert(`${n}P 차감했습니다.`)}catch(err){console.error('학급 포인트 차감 오류',err);alert(`학급 포인트 차감에 실패했습니다.\n${err.message||err}`)}};
    const saveGoal=async()=>{const n=Math.max(100,Math.floor(Number(goal)||3000));await setDoc(doc(db,'classSettings','main'),{classPointGoal:n,rewardRoundId:classPoint.rewardRoundId||1},{merge:true});setGoal(String(n));alert(`학급 목표를 ${n.toLocaleString()}P로 저장했습니다.`)};
  const addCandidate=()=>{const v=candidateText.trim();if(!v)return;if(candidates.includes(v))return alert('이미 있는 후보예요.');if(candidates.length>=6)return alert('보상 후보는 최대 6개까지 등록할 수 있어요.');setCandidates([...candidates,v]);setCandidateText('')};
  const saveCandidates=async()=>{if(candidates.length<2)return alert('보상 후보를 2개 이상 등록해주세요.');await setDoc(doc(db,'classSettings','main'),{rewardCandidates:candidates},{merge:true});alert('보상 후보를 저장했습니다.')};
  const startVote=async()=>{if(candidates.length<2)return alert('후보를 2개 이상 등록해주세요.');if(!window.confirm('학생들에게 이번 목표 보상 투표를 시작할까요?'))return;await setDoc(doc(db,'classSettings','main'),{rewardCandidates:candidates,rewardVoteActive:true,rewardSelected:'',rewardVoteStartedAt:serverTimestamp()},{merge:true});alert('학생 화면에 보상 투표가 시작되었습니다.')};
  const counts=candidates.map(c=>({name:c,count:votes.filter(v=>v.choice===c).length}));
  const finishVote=async()=>{if(!votes.length)return alert('아직 투표한 학생이 없어요.');const max=Math.max(...counts.map(x=>x.count));const winners=counts.filter(x=>x.count===max);if(winners.length!==1)return alert('현재 1위가 동점이에요. 투표를 조금 더 진행하거나 다시 투표해주세요.');const winner=winners[0].name;if(!window.confirm(`투표를 종료하고 '${winner}'을(를) 이번 목표 보상으로 확정할까요?`))return;await setDoc(doc(db,'classSettings','main'),{rewardVoteActive:false,rewardSelected:winner,rewardVoteEndedAt:serverTimestamp()},{merge:true});alert(`이번 목표 보상은 '${winner}'으로 확정되었습니다!`)};
  const newRound=async()=>{if(!window.confirm('현재 보상을 완료 처리하고 학급 포인트를 0P부터 새로 시작할까요?\n이전 적립 내역은 기록으로 남습니다.'))return;await setDoc(doc(db,'classSettings','main'),{rewardRoundId:(classPoint.rewardRoundId||1)+1,rewardVoteActive:false,rewardSelected:'',rewardCandidates:[],rewardRoundStartedAt:serverTimestamp()},{merge:true});setCandidates([]);alert('새 학급 포인트 목표를 시작했습니다.')};
  return <div className="teacher-classpoint-grid"><div className="teacher-card"><div className="teacher-section-head"><div><h2>🏫 학급 포인트 관리</h2><p>학생들이 개인 포인트를 우리 반 공동 포인트로 적립한 결과입니다.</p></div><span className="live-badge">● 실시간</span></div><div className="teacher-class-total"><div><span>현재 학급 포인트</span><strong>{classPoint.total.toLocaleString()}P</strong></div><div><span>목표</span><strong>{classPoint.goal.toLocaleString()}P</strong></div></div><div className="class-progress large"><i style={{width:`${Math.min(100,classPoint.total/classPoint.goal*100)}%`}}/></div><div className="goal-editor"><label><span>목표 포인트</span><input type="number" min="100" step="100" value={goal} onChange={e=>setGoal(e.target.value)}/></label><button onClick={saveGoal}>목표 저장</button></div>{classPoint.rewardSelected&&<div className="teacher-selected-reward"><span>🎉 현재 확정 보상</span><strong>{classPoint.rewardSelected}</strong></div>}</div><div className="teacher-card"><h2>➕ 학급 포인트 추가</h2><p className="muted-note">행사 보상, 특별 활동 등 교사가 학급 공동 포인트를 직접 추가할 수 있어요.</p><div className="class-deduct-row"><input type="number" min="1" value={addAmount} onChange={e=>setAddAmount(e.target.value)} placeholder="추가 포인트"/><input value={addReason} onChange={e=>setAddReason(e.target.value)} placeholder="추가 사유 (예: 학급 미션 성공)"/><button className="primary-action" onClick={addClassPoints}>추가하기</button></div></div><div className="teacher-card"><h2>➖ 학급 포인트 차감</h2><p className="muted-note">학급 보상 사용, 잘못 적립된 포인트 정리 등에 사용하세요. 차감 내역은 아래 기록에 남습니다.</p><div className="class-deduct-row"><input type="number" min="1" max={classPoint.total} value={deductAmount} onChange={e=>setDeductAmount(e.target.value)} placeholder="차감 포인트"/><input value={deductReason} onChange={e=>setDeductReason(e.target.value)} placeholder="차감 사유 (예: 학급 보상 사용)"/><button className="danger-btn" onClick={deductClassPoints}>차감하기</button></div></div><div className="teacher-card"><h2>🎁 이번 목표 보상 후보</h2><p className="muted-note">선생님이 원하는 후보를 몇 개 등록한 뒤 투표를 시작하세요. 처음에는 학생 화면에 후보가 보이고, 투표 종료 후에는 선택된 보상 하나만 강조해서 보입니다.</p><div className="candidate-editor"><div className="candidate-add"><input value={candidateText} onChange={e=>setCandidateText(e.target.value)} placeholder="예: 과자 파티" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCandidate()}}}/><button onClick={addCandidate}>후보 추가</button></div><div className="candidate-chips">{candidates.map(c=><span key={c}>{c}<button onClick={()=>setCandidates(candidates.filter(x=>x!==c))}>×</button></span>)}</div><div className="candidate-actions"><button className="light-action" onClick={saveCandidates}>후보 저장</button><button className="primary-action" disabled={classPoint.rewardVoteActive||!!classPoint.rewardSelected||candidates.length<2} onClick={startVote}>{classPoint.rewardVoteActive?'투표 진행 중':classPoint.rewardSelected?'보상 확정 완료':'학생 투표 시작'}</button></div></div></div>{classPoint.rewardVoteActive&&<div className="teacher-card"><div className="teacher-section-head"><div><h2>🗳️ 보상 투표 현황</h2><p>총 {votes.length}명이 참여했습니다.</p></div><span className="live-badge">● 실시간</span></div><div className="reward-tally">{counts.map(x=><div key={x.name}><span>{x.name}</span><strong>{x.count}표</strong></div>)}</div><button className="finish-vote-btn" onClick={finishVote}>투표 종료 · 1위 보상 확정</button></div>}<div className="teacher-card"><h2>🔄 다음 목표 시작</h2><p className="muted-note">보상을 실제로 제공한 뒤 사용하세요. 누르면 현재 회차는 기록으로 남고 학급 포인트가 새 회차에서 0P부터 시작합니다.</p><button className="new-round-btn" disabled={!classPoint.rewardSelected} onClick={newRound}>보상 완료 · 새 목표 시작</button></div><div className="teacher-card"><h2>🌱 학생 적립 내역</h2>{classPoint.contributions.length?<div className="teacher-suggestion-list">{[...classPoint.contributions].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).map(x=><div className="teacher-suggestion-item" key={x.id}><div className="suggestion-main"><div className="suggestion-meta"><strong>{x.studentName||'학생'}</strong><span>{formatCreatedAt(x.createdAt)}</span></div><p>{x.reason|| (Number(x.amount)>=0?'우리 반 포인트 적립':'학급 포인트 차감')}</p></div><b className={Number(x.amount)>=0?'class-add-amount':'class-minus-amount'}>{Number(x.amount)>0?'+':''}{x.amount}P</b></div>)}</div>:<Empty text="아직 이번 회차에 적립된 학급 포인트가 없어요."/>}</div></div>;
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
