class HarnessControlPlane < Formula
  desc "Interactive visual control plane for your AI coding harness"
  homepage "https://github.com/spyrae/harness-control-plane"
  url "https://registry.npmjs.org/harness-control-plane/-/harness-control-plane-0.1.0.tgz"
  sha256 "69cd331efcaed7a23a46d89c243605cd777b0a65121b2b3d32fe91e2c14635b2"
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
