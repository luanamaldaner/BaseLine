export const VISION_CORRECTION_GUIDANCE = 'Use your usual vision correction. Reduce glare by adjusting lighting or camera position; recalibrate and repeat if tracking is unreliable.';

export default function MeasurementIssue({ result, onRepeat, onSetup }) {
  const reasons = result?.reasons?.length ? result.reasons : [result?.reason || 'The camera could not capture a reliable eye measurement.'];
  return (
    <div className="callout warn" role="alert">
      <b>Measurement unreliable — repeat the test</b>
      <ul>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      <p>No eye-function grade was produced. This capture is excluded from grading and will not be saved.</p>
      <p className="small">{VISION_CORRECTION_GUIDANCE}</p>
      {(onRepeat || onSetup) && <div className="row">
        {onRepeat && <button className="primary" onClick={onRepeat}>Recalibrate and repeat</button>}
        {onSetup && <button className="ghost" onClick={onSetup}>Review camera setup</button>}
      </div>}
    </div>
  );
}
