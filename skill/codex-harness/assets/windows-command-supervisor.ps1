param([Parameter(Mandatory=$true)][string]$PipeName)
$ErrorActionPreference = 'Stop'
$client = $null
$reader = $null
$writer = $null
try {
  $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
  $client.Connect(10000)
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $reader = [System.IO.StreamReader]::new($client, $utf8, $false, 4096, $true)
  $writer = [System.IO.StreamWriter]::new($client, $utf8, 4096, $true)
  $writer.AutoFlush = $true
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class HarnessJobResult {
  public int exitCode; public bool confirmed; public bool timedOut;
  public string type = "final";
}
public static class HarnessJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string lpReserved, lpDesktop, lpTitle; public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr hProcess,hThread; public uint dwProcessId,dwThreadId; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int informationClass,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int informationClass,out ACCOUNTING info,uint size,IntPtr returned);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUP startup,out PROCESS process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static IntPtr Duplicate(int kind) { IntPtr result; Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(kind),GetCurrentProcess(),out result,0,true,2)); return result; }
  static uint Active(IntPtr job) { ACCOUNTING info; Check(QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)); return info.ActiveProcesses; }
  public static HarnessJobResult Run(string command,string cwd,string shell,Dictionary<string,string> environment,int remainingMs,StreamReader reader) {
    IntPtr job=IntPtr.Zero, block=IntPtr.Zero, input=IntPtr.Zero, output=IntPtr.Zero, error=IntPtr.Zero;
    PROCESS process=new PROCESS(); bool assigned=false, launched=false, timedOut=false; uint exitCode=1;
    var clock=System.Diagnostics.Stopwatch.StartNew();
    try {
      var cancellation=reader.ReadLineAsync();
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limits=new EXTENDED_LIMIT(); limits.BasicLimitInformation.LimitFlags=0x2000;
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
      var keys=new List<string>(environment.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase);
      var values=new StringBuilder(); foreach(var key in keys) values.Append(key).Append('=').Append(environment[key]).Append('\0'); values.Append('\0');
      block=Marshal.StringToHGlobalUni(values.ToString());
      input=Duplicate(-10); output=Duplicate(-11); error=Duplicate(-12);
      var startup=new STARTUP(); startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP)); startup.dwFlags=0x100; startup.hStdInput=input; startup.hStdOutput=output; startup.hStdError=error;
      if(clock.ElapsedMilliseconds>=remainingMs || cancellation.IsCompleted) return new HarnessJobResult { exitCode=124, timedOut=true, confirmed=true };
      // Suspension closes the launch-to-assignment race. The job handle is never inherited.
      Check(CreateProcess(shell,new StringBuilder("\""+shell+"\" /d /s /c \""+command+"\""),IntPtr.Zero,IntPtr.Zero,true,0x4|0x400|0x08000000,block,cwd,ref startup,out process));
      launched=true; Check(AssignProcessToJobObject(job,process.hProcess)); assigned=true;
      if(clock.ElapsedMilliseconds>=remainingMs || cancellation.IsCompleted) { timedOut=true; Check(TerminateJobObject(job,124)); }
      else Check(ResumeThread(process.hThread)!=0xffffffff);
      CloseHandle(process.hThread); process.hThread=IntPtr.Zero;
      CloseHandle(input); input=IntPtr.Zero; CloseHandle(output); output=IntPtr.Zero; CloseHandle(error); error=IntPtr.Zero;
      while(true) {
        if(process.hProcess!=IntPtr.Zero && WaitForSingleObject(process.hProcess,0)==0) { Check(GetExitCodeProcess(process.hProcess,out exitCode)); CloseHandle(process.hProcess); process.hProcess=IntPtr.Zero; }
        if(Active(job)==0) {
          // The shell can exit between the first handle check and the job query.
          // Reap its real exit code before returning confirmed completion.
          if(process.hProcess!=IntPtr.Zero) { Check(WaitForSingleObject(process.hProcess,5000)==0); Check(GetExitCodeProcess(process.hProcess,out exitCode)); CloseHandle(process.hProcess); process.hProcess=IntPtr.Zero; }
          return new HarnessJobResult { exitCode=timedOut?124:unchecked((int)exitCode), timedOut=timedOut, confirmed=true };
        }
        if(!timedOut && (clock.ElapsedMilliseconds>=remainingMs || cancellation.IsCompleted)) { timedOut=true; Check(TerminateJobObject(job,124)); }
        if(timedOut && clock.ElapsedMilliseconds>=remainingMs+5000) return new HarnessJobResult { exitCode=124, timedOut=true, confirmed=false };
        Thread.Sleep(10);
      }
    } finally {
      // Closing the sole job handle also contains controller failure or forced shutdown.
      if(launched && !assigned && process.hProcess!=IntPtr.Zero) { TerminateProcess(process.hProcess,1); WaitForSingleObject(process.hProcess,5000); }
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(process.hThread!=IntPtr.Zero) CloseHandle(process.hThread);
      if(process.hProcess!=IntPtr.Zero) CloseHandle(process.hProcess);
      if(input!=IntPtr.Zero) CloseHandle(input); if(output!=IntPtr.Zero) CloseHandle(output); if(error!=IntPtr.Zero) CloseHandle(error);
      if(block!=IntPtr.Zero) Marshal.FreeHGlobal(block);
    }
  }
}
'@
  $writer.WriteLine('{"type":"ready"}')
  $request = $reader.ReadLine() | ConvertFrom-Json
  if ($null -eq $request -or $request.type -ne 'start') {
    $result = @{ type='final'; exitCode=124; timedOut=$true; confirmed=$true }
  } else {
    $environment = [System.Collections.Generic.Dictionary[string,string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in [System.Environment]::GetEnvironmentVariables().GetEnumerator()) { $environment.Add([string]$entry.Key, [string]$entry.Value) }
    $shell = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('System'), 'cmd.exe')
    $result = [HarnessJob]::Run([string]$request.command, [string]$request.cwd, $shell, $environment, [int]$request.remainingMs, $reader)
  }
  $writer.WriteLine(($result | ConvertTo-Json -Compress))
} catch {
  if ($null -ne $writer) { $writer.WriteLine((@{ type='final'; exitCode=1; timedOut=$false; confirmed=$false; error=('Windows command containment initialization failed: ' + $_.Exception.Message) } | ConvertTo-Json -Compress)) }
  else {
    $diagnostic = [System.Text.UTF8Encoding]::new($false).GetBytes('Windows command containment initialization failed: ' + $_.Exception.Message + "`n")
    $stderr = [System.Console]::OpenStandardError()
    $stderr.Write($diagnostic, 0, $diagnostic.Length)
  }
} finally {
  if ($null -ne $writer) { $writer.Dispose() }
  if ($null -ne $reader) { $reader.Dispose() }
  if ($null -ne $client) { $client.Dispose() }
}
