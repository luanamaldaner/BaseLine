import TodoTest from '../../components/TodoTest.jsx';

// TODO(balance owner): DeviceMotion capture, phone held flat to the chest.
// 3 stances x 20 s, eyes closed. On iOS, call DeviceMotionEvent.requestPermission()
// from a button tap before listening. Needs HTTPS on a phone: `npm run dev:phone`.
export default function BalanceTest() {
  return (
    <TodoTest
      title="Balance"
      description="Phone held flat against the chest. Feet together, single leg, heel-to-toe; 20 seconds each, eyes closed."
      spec={['Sway RMS per stance (m/s²)', 'Sway path length', 'Jerk']}
    />
  );
}
