import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성에서 복사해서 붙여넣으세요.
const firebaseConfig = {
  apiKey: "AIzaSyDylWDq5ZMsL8lRelGbdgHanpikYcsCzuo",
  authDomain: "classroom-app-1a376.firebaseapp.com",
  projectId: "classroom-app-1a376",
  storageBucket: "classroom-app-1a376.firebasestorage.app",
  messagingSenderId: "448336205821",
  appId: "1:448336205821:web:f3a4d6d5f24f3a180e6b94"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
