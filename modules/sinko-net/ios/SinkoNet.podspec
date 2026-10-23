Pod::Spec.new do |s|
  s.name           = 'SinkoNet'
  s.version        = '1.0.0'
  s.summary        = 'The IPv4 addresses a host name resolves to, for the app\'s host rule.'
  s.description    = s.summary
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'iret33'
  s.homepage       = 'https://github.com/iret33/sinko'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
