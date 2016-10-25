
import sys

print(sys.api_version)

class Class1(object):
    """Some class
    And the second line
    """

    description = "Run isort on modules registered in setuptools"
    user_options = []

    def __init__(self, file_path=None, file_contents=None):
        self.prop1 = ''
        self.prop2 = 1

    def method1(self):
        """
        This is method1
        """
        pass

    def method2(self):
        """
        This is method2
        """
        pass

obj = Class1()
print(obj.description)
print(obj.method1)