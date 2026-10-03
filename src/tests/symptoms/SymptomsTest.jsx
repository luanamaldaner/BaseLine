import TodoTest from '../../components/TodoTest.jsx';

// TODO(UI owner): SCAT-style checklist, 22 symptoms each rated 0-6.
export default function SymptomsTest() {
  return (
    <TodoTest
      title="Symptoms"
      description="22 standard symptoms (headache, dizziness, blurred vision, ...) each rated 0-6."
      spec={['Number of symptoms (0-22)', 'Symptom severity (0-132)']}
    />
  );
}
