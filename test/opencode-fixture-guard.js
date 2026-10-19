import { execFileSync } from 'node:child_process';

export default async function FixtureGuard(_context, options = {}) {
  const pid = Number(options.pid);
  if (!Number.isSafeInteger(pid) || pid < 1 || typeof options.title !== 'string') throw new Error('fixture guard needs a target');
  const checkForeground = () => {
    const script = 'Add-Type -Namespace CuFixtureGuard -Name Native -MemberDefinition ' +
      "'[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow(); " +
      '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);' +
      "'; $target = [uint32]0; [void][CuFixtureGuard.Native]::GetWindowThreadProcessId([CuFixtureGuard.Native]::GetForegroundWindow(), [ref]$target); Write-Output $target";
    return Number(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim());
  };
  return {
    'tool.execute.before': async (input, output) => {
      if (!input.tool.startsWith('computer_')) return;
      if (['computer_click', 'computer_move', 'computer_drag'].includes(input.tool))
        throw new Error('This isolated test only permits named controls in its fixture. Use computer_focus and computer_tap for the named field.');
      if (['computer_focus', 'computer_tap'].includes(input.tool)) {
        if (!(output.args?.pid === pid && output.args?.window === undefined)
          && !(output.args?.window === options.title && output.args?.pid === undefined))
          throw new Error('The isolated fixture is the only allowed input target; use its observed pid.');
      }
      if (['computer_type', 'computer_press', 'computer_scroll'].includes(input.tool) && checkForeground() !== pid)
        throw new Error('The fixture is not foreground. No input was sent; focus the fixture and tap its named field first.');
    },
  };
}
