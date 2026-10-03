import TodoTest from '../../components/TodoTest.jsx';

// TODO(reaction owner): screen turns green after a random 1-4 s delay, tap as
// fast as possible, 15 trials. Tapping early = false start (count it, redo trial).
export default function ReactionTest() {
  return (
    <TodoTest
      title="Reaction time"
      description="Tap as soon as the screen turns green. 15 trials with random delays."
      spec={['Median reaction time (ms)', 'Spread (IQR, ms)', 'False starts']}
    />
  );
}
