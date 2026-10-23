// The way from "the app is opened" to "signed in": one screen for each phase of the connection's gate (src/state/connection.ts).
import { useStore } from '../src/state/hooks';
import { connection } from '../src/state/app';
import { Checking, Claim, FindBox, Home, SignIn, Starting, Unreachable, Waiting } from '../src/screens';

export default function Index() {
  const gate = useStore(connection.gate);
  switch (gate.phase) {
    case 'starting': return <Starting />;
    case 'find': return <FindBox />;
    case 'checking': return <Checking />;
    case 'unreachable': return <Unreachable message={gate.message} />;
    case 'claim': return <Claim />;
    case 'notInstalled': return <Waiting since={gate.since} checkedAt={gate.checkedAt} />;
    case 'signIn': return <SignIn note={gate.note} totp={gate.totp} />;
    case 'ready': return <Home />;
  }
}
