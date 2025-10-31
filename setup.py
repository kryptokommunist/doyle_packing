from setuptools import Extension, setup
import numpy

extensions = [
    Extension(
        name="_geometry_accel",
        sources=["src/_geometry_accel.cpp"],
        include_dirs=[numpy.get_include()],
        language="c++",
        extra_compile_args=["-std=c++17"],
    )
]

setup(
    name="doyle_packing",
    version="0.0.0",
    ext_modules=extensions,
)
