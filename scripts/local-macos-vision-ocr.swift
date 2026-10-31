import Foundation
import Vision
import ImageIO
import AppKit
import PDFKit

struct OCRLine: Encodable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OCRResult: Encodable {
  let orientation: String
  let text: String
  let lines: [OCRLine]
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write(Data("usage: swift local-macos-vision-ocr.swift /path/to/image\n".utf8))
  exit(2)
}

let url = URL(fileURLWithPath: args[1])

func renderFirstPdfPage(_ url: URL) -> CGImage? {
  guard let document = PDFDocument(url: url),
        let page = document.page(at: 0) else { return nil }
  let box = page.bounds(for: .mediaBox)
  let scale: CGFloat = 3.0
  let width = max(Int(box.width * scale), 1)
  let height = max(Int(box.height * scale), 1)
  let image = NSImage(size: NSSize(width: width, height: height))
  image.lockFocus()
  guard let context = NSGraphicsContext.current?.cgContext else {
    image.unlockFocus()
    return nil
  }
  NSColor.white.set()
  context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  image.unlockFocus()
  var rect = CGRect(origin: .zero, size: image.size)
  return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

let image: CGImage
if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
   let decoded = CGImageSourceCreateImageAtIndex(source, 0, nil) {
  image = decoded
} else if url.pathExtension.lowercased() == "pdf", let rendered = renderFirstPdfPage(url) {
  image = rendered
} else {
  FileHandle.standardError.write(Data("cannot read image or render pdf\n".utf8))
  exit(3)
}

let orientations: [(String, CGImagePropertyOrientation)] = [
  ("up", .up),
  ("right", .right),
  ("down", .down),
  ("left", .left),
]

func recognize(_ orientationName: String, _ orientation: CGImagePropertyOrientation) throws -> OCRResult {
  var lines: [OCRLine] = []
  let request = VNRecognizeTextRequest { request, error in
    if let error = error {
      FileHandle.standardError.write(Data(error.localizedDescription.utf8))
      return
    }
    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    lines = observations.compactMap { observation in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let box = observation.boundingBox
      return OCRLine(
        text: candidate.string,
        confidence: candidate.confidence,
        x: box.origin.x,
        y: box.origin.y,
        width: box.size.width,
        height: box.size.height
      )
    }
  }
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try handler.perform([request])
  let sorted = lines.sorted {
    if abs($0.y - $1.y) > 0.015 { return $0.y > $1.y }
    return $0.x < $1.x
  }
  return OCRResult(orientation: orientationName, text: sorted.map(\.text).joined(separator: "\n"), lines: sorted)
}

var best: OCRResult?
for (name, orientation) in orientations {
  if let result = try? recognize(name, orientation) {
    let useful = result.text.filter { !$0.isWhitespace }.count
    let current = best?.text.filter { !$0.isWhitespace }.count ?? -1
    if useful > current { best = result }
  }
}

guard let output = best else {
  FileHandle.standardError.write(Data("ocr failed\n".utf8))
  exit(4)
}
let data = try JSONEncoder().encode(output)
FileHandle.standardOutput.write(data)
