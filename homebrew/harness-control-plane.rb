class HarnessControlPlane < Formula
  desc "Interactive visual control plane for your AI coding harness"
  homepage "https://github.com/spyrae/harness-control-plane"
  url "https://registry.npmjs.org/harness-control-plane/-/harness-control-plane-0.1.0.tgz"
  sha256 "074cb2c61922f415b0f60535dcc578a5c129c3a79259bddab5c738c53e788883"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/hcp --version")
    assert_match version.to_s, output
  end
end
