import { redirect } from 'next/navigation';
import DevLoginClient from './DevLoginClient';

export default function DevLoginPage() {
  if (process.env.NEXT_PUBLIC_DEV_MODE !== 'true') {
    redirect('/');
  }
  return <DevLoginClient />;
}
