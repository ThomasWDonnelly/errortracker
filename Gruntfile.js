﻿module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    requirejs: {
      build: {
        options: {
          findNestedDependencies: true,
          wrap: false,
          baseUrl: 'src/',
          include: ['ErrorTracker'],
          globalModules: ['ErrorTracker'],
          out: 'dist/errortracker.js',
		  optimize: 'none',
          onModuleBundleComplete: function (data) {
            var fs = require('fs'),
              amdclean = require('amdclean'),
              outputFile = data.path;
            fs.writeFileSync(outputFile, amdclean.clean({
              'filePath': outputFile,
              'wrap': {
                'start': ';(function() {',
                'end': '}());'
              }
            }));
          }
        }
      }
    }

  });

  grunt.loadNpmTasks('grunt-contrib-requirejs');

  grunt.registerTask('default', ['requirejs:build']);

};
