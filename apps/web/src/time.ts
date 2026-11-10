function parts(value: Date, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function toDateInput(value: string, zone: string): string {
  return parts(new Date(value), zone);
}
export function inputToISO(value: string, zone: string): string {
  const desired = Date.parse(`${value}:00Z`);
  let timestamp = desired;
  for (let i = 0; i < 4; i++) {
    const shown = Date.parse(`${parts(new Date(timestamp), zone)}:00Z`);
    timestamp += desired - shown;
  }
  if (parts(new Date(timestamp), zone) !== value)
    throw new Error(
      'This local time does not exist because of daylight saving. Choose another time.',
    );
  return new Date(timestamp).toISOString();
}
