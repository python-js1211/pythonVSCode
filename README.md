# Python
Linting, Debugging (multi threaded, web apps), Intellisense, auto-completion, code formatting, snippets, unit testing, and more.
Works on both Windows and Mac.

##Features
* Linting (PyLint, Pep8, Flake8 with config files)
* Intellisense and autocompletion
* Code formatting (autopep8, yapf, with config files)
* Renaming, Viewing references, Going to definitions, Go to Symbols
* View signature and similar by hovering over a function or method
* Debugging with support for local variables, arguments, expressions, watch window, stack information, break points
* Debugging Multiple threads (Web Applications, etc) and expanding values in watch windows is supported on Windows
* Unit testing (unittests and nosetests, with config files)
* Sorting imports
* Snippets

## Issues and Feature Requests 
[Github Issues](https://github.com/DonJayamanne/pythonVSCode/issues)
* Remote Debugging (coming soon)
* Improved debugging for Mac (in development)

## Feature Details (with confiuration)
* IDE Features
* - Rename and navigate to symbols
* - Go to, Peek and hover definition
* - Find all references
* - View Signature
* - Sorting Import statements (use "Python: Sort Imports" command)
* Intellisense and Autocomplete
* - Full intellisense
* - Support for docstring
* - Ability to include custom module paths (e.g. include paths for libraries like Google App Engine, etc)
* - - Use the setting python.autoComplete.extraPaths = []
* - - For instance getting autocomplete/intellisense for Google App Engine, add the following to your settings file:
```json
"python.autoComplete.extraPaths": [
    "C:/Program Files (x86)/Google/google_appengine",
    "C:/Program Files (x86)/Google/google_appengine/lib"
    ]
```
* Code formatting
* - Use either yapf or autopep8 for code formatting (defaults to autopep8)
* - auutopep8 configuration files supported
* - yapf configuration files supported
* Linting
* - It can be turned off (default is turn it on and use pylint)
* - pylint can be turned on/off (default is on), supports standard configuaration files
* - pep8 can be turned on/off (default is off), supports standard configuaration files
* - flake8 can be turned on/off (default is on), supports standard configuaration files
* - Different categories of errors reported by pylint can be configured as warnings, errors, information or hits
* - Path to pylint, pep8 and flake8 and pep8 can be configured
* Debuggging
* - Watch window
* - Evaluate Expressions
* - Step through code (Step in, Step out, Continue)
* - Add/remove break points
* - Local variables and arguments
* - Multiple Threads and Web Applications (such as Flask) (only Windows at this stage)
* - Expanding values (viewing children, properties, etc) again only Windows at this Stage
* Unit Testing
* - unittests (default is on)
* - nosetests (default is off)
* - Test resutls are displayed in the "Python" output window
* - Future release will display results in a more structured manner integrated into the IDE
* Snippets


![Image of Generate Features](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/general.gif)

![Image of Go To Definition](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/goToDef.gif)

![Image of Renaming and Find all References](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/rename.gif)

![Image of Debugging](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/standardDebugging.gif)

![Image of Multi Threaded Debugging](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/flaskDebugging.gif)

## Requirements
* Python is installed on the current system
* - Path to python can be configured
* Pylint is installed for linting (optional)
* - pip install pylint
* Pep8 is installed for linting (optional)
* - pip install pep8
* Flake8 is installed for linting (optional)
* - pip install flake8
* Autopep8 is installed for code formatting (optional) 
* - pip install pep8
* - pip install --upgrade autopep8
* Yapf is installed for code formatting (optional)
* - pip install yapf
* nosetests for unit testing  (optional)
* - pip install nose

## Change Log

### Version 0.2.0
* Improved debugger for Windows, with support for Multi threading, debugging Multi-threaded apps, Web Applications, expanding properties, etc
* Added support for relative paths for extra paths in additional libraries for Auto Complete
* Fixed a bug where paths to custom Python versions weren't respected by the previous (PDB) debugger
* NOTE: PDB Debugger is still supported

### Version 0.1.3
* Fixed linting when using pylint

### Version 0.1.2
* Fixed autoformatting of code (falling over when using yapf8)

### Version 0.1.1
* Added support for linting using flake8
* Added support for unit testing using unittest and nosetest
* Added support for custom module paths for improved intellisense and autocomplete
* Modifications to debugger to display console output (generated using 'print' and the like)
* Modifications to debugger to accept arguments

### Version 0.1.0
* Fixed linting of files on Mac
* Added support for linting using pep8
* Added configuration support for pep8 and pylint
* Added support for configuring paths for pep8, pylint and autopep8
* Added snippets
* Added support for formatting using yapf
* Added a number of configuration settings

### Version 0.0.4
* Added support for linting using Pylint (configuring pylint is coming soon)
* Added support for sorting Imports (Using the command "Pythong: Sort Imports")
* Added support for code formatting using Autopep8 (configuring autopep8 is coming soon)
* Added ability to view global variables, arguments, add and remove break points

### Version 0.0.3
* Added support for debugging using PDB


## Debugging Instructions
* Use the Python debugger, set the name of the startup program


## Source

[Github](https://github.com/DonJayamanne/pythonVSCode)

                
## License

[MIT](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/LICENSE)
