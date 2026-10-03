import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Black on white in both themes: phone cameras read that most reliably.
export default function QrCode({ text, label }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [text]);

  return (
    <div
      className="qr"
      role="img"
      aria-label={label}
      // The SVG string comes from the qrcode library, not from user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
