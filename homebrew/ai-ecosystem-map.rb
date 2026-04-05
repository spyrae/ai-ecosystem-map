class AiEcosystemMap < Formula
  desc "Interactive visual control plane for your AI coding ecosystem"
  homepage "https://github.com/spyrae/ai-ecosystem-map"
  url "https://registry.npmjs.org/ai-ecosystem-map/-/ai-ecosystem-map-1.0.0.tgz"
  # sha256 will be filled after first npm publish
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/aem --version")
    assert_match version.to_s, output
  end
end
