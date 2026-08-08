import { useState } from 'react';
import { AuthGate } from './auth/AuthGate';
import { Home } from './screens/Home';
import { Submit } from './screens/Submit';
import { EstudioLibre } from './screens/EstudioLibre';
import { ParentPanel } from './screens/ParentPanel';
import type { Lesson } from './api/types';

type Screen = 'home' | 'submit' | 'estudio-libre' | 'parent-panel';

function AppShell() {
  const [screen, setScreen] = useState<Screen>('home');
  const [lesson, setLesson] = useState<Lesson | null>(null);

  if (screen === 'submit' && lesson) {
    return <Submit lesson={lesson} onNavigate={setScreen} />;
  }

  if (screen === 'estudio-libre') {
    return <EstudioLibre onNavigate={setScreen} />;
  }

  if (screen === 'parent-panel') {
    return <ParentPanel onNavigate={setScreen} />;
  }

  return <Home onNavigate={setScreen} onLessonLoaded={setLesson} />;
}

export default function App() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
