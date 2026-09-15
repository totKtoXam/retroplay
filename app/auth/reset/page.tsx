import ResetForm from '@/components/reset-form';
/** Страница из письма о сбросе пароля: `/auth/reset?token=…`. */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetForm token={token || ''} />;
}
