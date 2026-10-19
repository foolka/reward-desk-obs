using System;
using System.IO;
using System.Reflection;
[assembly: AssemblyFileVersion("0.6.0.0")]
[assembly: AssemblyInformationalVersion("0.6.0")]
public class UpdateFixture {
  public static void Main(string[] args) {
    string folder = AppDomain.CurrentDomain.BaseDirectory;
    foreach (string arg in args) {
      if (arg.StartsWith("/DIR=")) {
        string target = arg.Substring(5).Trim('"');
        File.Copy(Path.Combine(folder, "payload.exe"), Path.Combine(target, "RewardDesk.exe"), true);
        File.WriteAllText(Path.Combine(target, "installer-args.txt"), String.Join("\n", args));
        return;
      }
    }
    File.WriteAllText(Path.Combine(folder, "restarted.txt"), "test fixture only");
  }
}
