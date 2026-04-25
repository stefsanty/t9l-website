import { redirect } from 'next/navigation';
import DevLoginClient from './DevLoginClient';

export default function DevLoginPage() {
  if (process.env.NEXTAUTH_DEV_MODE !== 'true') {
    redirect('/');
  }
  return <DevLoginClient />;
}
