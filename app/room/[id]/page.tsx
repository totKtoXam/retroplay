import RoomApp from '@/components/room-app';
export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoomApp id={id} />;
}
